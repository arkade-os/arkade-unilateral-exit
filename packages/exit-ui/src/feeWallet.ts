import {
    EsploraProvider,
    OnchainWallet,
    SingleKey,
    type ExitFeeWallet,
    type NetworkName,
} from "@arkade-os/sdk";
import { FEE_KEY_RE } from "./package";
import { defaultStore, type SessionStore } from "./session";

const STORAGE_KEY = "arkade-exit:fee-key";

/**
 * Generate 32 random bytes as a hex string using the Web Crypto API.
 */
function randomPrivKeyHex(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The graph-mode fee key is an EPHEMERAL, throwaway key the browser owns.
 * It only ever holds the sats the user sends to cover CPFP fees — never any
 * VTXO value — so persisting it to localStorage is low-risk and buys
 * recoverability: reloading the tab mid-exit resumes with the same funded
 * address instead of stranding the deposit.
 *
 * Losing it entirely only forfeits the small unspent fee remainder; the exit
 * itself is idempotent and can be re-funded with a fresh key.
 *
 * Storage is best-effort. It is reached through the same injectable
 * `SessionStore` the session uses, and every access is guarded: this runs inside
 * a React effect, where a throw is NOT caught by an error boundary, so an
 * unguarded `localStorage` call in Safari private mode (quota 0, `SecurityError`
 * on write) would take the whole page down with no message. A key that cannot be
 * persisted still works for this tab — only the reload-resume is lost.
 */
export function loadOrCreateFeeKey(store: SessionStore | null = defaultStore()): string {
    let existing: string | null = null;
    try {
        existing = store?.getItem(STORAGE_KEY) ?? null;
    } catch {
        /* storage unreadable — fall through and mint a fresh key */
    }
    if (existing && FEE_KEY_RE.test(existing)) return existing;

    const fresh = randomPrivKeyHex();
    try {
        store?.setItem(STORAGE_KEY, fresh);
    } catch {
        /* not persistable; the key is still usable for this tab */
    }
    return fresh;
}

export function resetFeeKey(store: SessionStore | null = defaultStore()): string {
    try {
        store?.removeItem(STORAGE_KEY);
    } catch {
        /* nothing to do — loadOrCreateFeeKey will mint a fresh one anyway */
    }
    return loadOrCreateFeeKey(store);
}

export interface FeeWalletHandle {
    /** The onchain address the user must fund. */
    address: string;
    /** The private key hex — surfaced for the "export key" affordance. */
    privKeyHex: string;
    /** Confirmed balance in sats. */
    confirmedBalance(): Promise<number>;
    /** Passed to `UnilateralExit.Executor` as its {@link ExitFeeWallet}. */
    wallet: OnchainWallet & ExitFeeWallet;
}

/**
 * Build an ephemeral fee wallet bound to the given network + Esplora
 * endpoint. `OnchainWallet` already implements {@link ExitFeeWallet} via
 * `bumpAnchor`, so the executor can use it directly.
 */
export async function makeFeeWallet(
    privKeyHex: string,
    network: NetworkName,
    esploraUrl: string,
): Promise<FeeWalletHandle> {
    const identity = SingleKey.fromHex(privKeyHex);
    const provider = new EsploraProvider(esploraUrl);
    const wallet = await OnchainWallet.create(identity, network, provider);
    return {
        address: wallet.address,
        privKeyHex,
        wallet,
        async confirmedBalance() {
            const coins = await wallet.getCoins();
            return coins.filter((c) => c.status.confirmed).reduce((sum, c) => sum + c.value, 0);
        },
    };
}
