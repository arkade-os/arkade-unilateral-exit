import { describe, expect, it } from "vitest";
import { loadOrCreateFeeKey, resetFeeKey, splitBalances } from "../src/feeWallet";
import type { SessionStore } from "../src/session";

const coin = (value: number, confirmed: boolean) => ({ value, status: { confirmed } });

const KEY = "arkade-exit:fee-key";
const HEX64 = /^[0-9a-f]{64}$/;

function fakeStore(initial?: Record<string, string>): SessionStore {
    const m = new Map<string, string>(Object.entries(initial ?? {}));
    return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
    };
}

/** Safari private mode: reads work, writes throw. */
function writeBlockedStore(): SessionStore {
    const inner = fakeStore();
    return {
        getItem: inner.getItem,
        setItem: () => {
            throw new DOMException("quota", "QuotaExceededError");
        },
        removeItem: inner.removeItem,
    };
}

describe("loadOrCreateFeeKey", () => {
    it("mints and persists a fresh 32-byte key", () => {
        const store = fakeStore();
        const key = loadOrCreateFeeKey(store);
        expect(key).toMatch(HEX64);
        expect(store.getItem(KEY)).toBe(key);
    });

    it("reuses an already-stored key, so a reload keeps the funded address", () => {
        const existing = "ab".repeat(32);
        expect(loadOrCreateFeeKey(fakeStore({ [KEY]: existing }))).toBe(existing);
    });

    it("replaces a malformed stored value rather than trusting it", () => {
        const store = fakeStore({ [KEY]: "not-a-key" });
        const key = loadOrCreateFeeKey(store);
        expect(key).toMatch(HEX64);
        expect(key).not.toBe("not-a-key");
    });

    // This runs inside a React effect, where a throw is NOT caught by an error
    // boundary — an unguarded localStorage call would blank the page instead.
    it("still returns a usable key when the store cannot be written", () => {
        expect(loadOrCreateFeeKey(writeBlockedStore())).toMatch(HEX64);
    });

    it("still returns a usable key when the store cannot be read", () => {
        const store: SessionStore = {
            getItem: () => {
                throw new DOMException("blocked", "SecurityError");
            },
            setItem: () => {},
            removeItem: () => {},
        };
        expect(loadOrCreateFeeKey(store)).toMatch(HEX64);
    });

    it("returns a usable key when there is no store at all", () => {
        expect(loadOrCreateFeeKey(null)).toMatch(HEX64);
    });
});

describe("splitBalances", () => {
    it("totals confirmed and mempool coins separately", () => {
        expect(splitBalances([coin(556, true), coin(2000, false), coin(10, true)])).toEqual({
            confirmed: 566,
            pending: 2000,
        });
    });

    it("is zero for an empty wallet", () => {
        expect(splitBalances([])).toEqual({ confirmed: 0, pending: 0 });
    });

    /**
     * The gap this exists to close. A user deposited 2000 sats, the transaction
     * sat unconfirmed, and the gate showed "556 / 1102" with no mention of it —
     * indistinguishable from the deposit never arriving.
     *
     * The gate must keep gating on `confirmed`, because `bumpAnchor` itself does
     * `getCoins().filter(c => c.status.confirmed)` — letting unconfirmed funds
     * open the gate would just move the failure into the executor. But it has to
     * *say* the money was seen.
     */
    it("keeps an unconfirmed deposit out of the spendable total but still reports it", () => {
        const b = splitBalances([coin(556, true), coin(2000, false)]);
        expect(b.confirmed).toBe(556);
        expect(b.confirmed >= 1102).toBe(false);
        expect(b.pending).toBe(2000);
        expect(b.confirmed + b.pending >= 1102).toBe(true);
    });
});

describe("resetFeeKey", () => {
    it("discards the stored key and mints a different one", () => {
        const existing = "ab".repeat(32);
        const store = fakeStore({ [KEY]: existing });
        const fresh = resetFeeKey(store);
        expect(fresh).toMatch(HEX64);
        expect(fresh).not.toBe(existing);
        expect(store.getItem(KEY)).toBe(fresh);
    });

    it("still mints a key when removal throws", () => {
        const store: SessionStore = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {
                throw new DOMException("blocked", "SecurityError");
            },
        };
        expect(resetFeeKey(store)).toMatch(HEX64);
    });
});
