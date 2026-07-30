import { describe, expect, it } from "vitest";
import type { ExitPackage } from "@arkade-os/sdk";
import { clearSession, loadSession, saveSession, type SessionStore } from "../src/session";

const pkg: ExitPackage = {
    version: 1,
    mode: "funded",
    network: "regtest",
    createdAt: 1720000000,
    feeRate: 2,
    sweepAddress: "bcrt1pexample",
    totals: { txCount: 1, totalFeeSats: 100, fundingRequiredSats: 200, recoveredSats: 900 },
    vtxos: [{ outpoint: "aa".repeat(32) + ":0", value: 1000, sweepFee: 100 }],
    steps: [{ kind: "broadcast", txid: "cc".repeat(32), hex: "02000000" }],
};

/** In-memory stand-in for localStorage — vitest runs in the `node` environment,
 * where `globalThis.localStorage` does not exist. */
function fakeStore(initial?: Record<string, string>): SessionStore {
    const m = new Map<string, string>(Object.entries(initial ?? {}));
    return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
    };
}

describe("saveSession / loadSession", () => {
    it("round-trips a package, endpoint and screen", () => {
        const store = fakeStore();
        expect(saveSession({ pkg, esploraUrl: "http://x/api", screen: "run" }, store)).toBe(true);
        expect(loadSession(store)).toMatchObject({
            pkg,
            esploraUrl: "http://x/api",
            screen: "run",
        });
    });

    // A bundle's embedded fee key is never written to `arkade-exit:fee-key`, so
    // without this the restored exit would mint a different, unfunded key.
    it("round-trips an embedded fee key", () => {
        const store = fakeStore();
        const feeKeyHex = "ab".repeat(32);
        saveSession({ pkg, esploraUrl: "http://x/api", feeKeyHex, screen: "run" }, store);
        expect(loadSession(store)?.feeKeyHex).toBe(feeKeyHex);
    });

    it("returns null when nothing is stored", () => {
        expect(loadSession(fakeStore())).toBeNull();
    });

    it("returns false rather than throwing when storage rejects the write", () => {
        const store: SessionStore = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException("quota", "QuotaExceededError");
            },
            removeItem: () => {},
        };
        expect(saveSession({ pkg, screen: "review" }, store)).toBe(false);
    });

    // A failed save must not leave the PREVIOUS session behind: the next load
    // would restore a different exit than the one on screen, so the user would
    // resume the wrong package.
    it("drops any previously stored session when a save fails", () => {
        const store = fakeStore();
        saveSession({ pkg, esploraUrl: "http://old/api", screen: "review" }, store);
        expect(loadSession(store)).not.toBeNull();

        const older = { ...pkg, sweepAddress: "bcrt1pthisistheoldone" };
        const failing: SessionStore = {
            ...store,
            setItem: () => {
                throw new DOMException("quota", "QuotaExceededError");
            },
        };
        expect(saveSession({ pkg: older, screen: "review" }, failing)).toBe(false);
        expect(loadSession(store)).toBeNull();
    });

    it("still returns false when clearing after a failed save also throws", () => {
        const store: SessionStore = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException("quota", "QuotaExceededError");
            },
            removeItem: () => {
                throw new Error("storage is entirely unavailable");
            },
        };
        expect(saveSession({ pkg, screen: "review" }, store)).toBe(false);
    });
});

describe("loadSession treats stored state as untrusted", () => {
    it("returns null for malformed JSON", () => {
        expect(loadSession(fakeStore({ "arkade-exit:session": "not json" }))).toBeNull();
    });

    it("returns null when the stored package fails validation", () => {
        const bad = JSON.stringify({ pkg: { ...pkg, totals: undefined }, screen: "run" });
        expect(loadSession(fakeStore({ "arkade-exit:session": bad }))).toBeNull();
    });

    it("returns null when the stored screen is not a known screen", () => {
        const bad = JSON.stringify({ pkg, screen: "elsewhere" });
        expect(loadSession(fakeStore({ "arkade-exit:session": bad }))).toBeNull();
    });

    it("drops a malformed fee key rather than restoring it", () => {
        const bad = JSON.stringify({ pkg, screen: "run", feeKeyHex: "nope" });
        expect(loadSession(fakeStore({ "arkade-exit:session": bad }))?.feeKeyHex).toBeUndefined();
    });
});

describe("clearSession", () => {
    it("removes a stored session", () => {
        const store = fakeStore();
        saveSession({ pkg, screen: "review" }, store);
        clearSession(store);
        expect(loadSession(store)).toBeNull();
    });
});
