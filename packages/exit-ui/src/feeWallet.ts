import {
    EsploraProvider,
    OnchainWallet,
    SingleKey,
    type ExitFeeWallet,
    type NetworkName,
} from "@arkade-os/sdk";
import { quoteFeeSweep, SWEEP_DUST_SATS } from "./feeRecovery";
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

export interface FeeBalances {
    /** Spendable now. The only figure the funding gate may act on. */
    confirmed: number;
    /** Seen in the mempool but not yet spendable. Reportable, never actionable. */
    pending: number;
}

/**
 * Split coins into what can be spent now and what is merely visible.
 *
 * Pure, and tested, because the distinction is the whole point and it is not
 * cosmetic: `OnchainWallet.bumpAnchor` does
 * `getCoins().filter(c => c.status.confirmed)` before selecting inputs, so an
 * unconfirmed deposit genuinely cannot pay a CPFP bump. Letting it open the
 * funding gate would only move the failure one screen later, into the executor.
 *
 * It still has to be reported. A deposit that has landed in the mempool but is
 * absent from the UI is indistinguishable from one that never arrived, which
 * leaves the user to guess whether to send more.
 */
export function splitBalances(
    coins: readonly { value: number; status: { confirmed: boolean } }[],
): FeeBalances {
    let confirmed = 0;
    let pending = 0;
    for (const c of coins) {
        if (c.status.confirmed) confirmed += c.value;
        else pending += c.value;
    }
    return { confirmed, pending };
}

export interface FeeWalletHandle {
    /** The onchain address the user must fund. */
    address: string;
    /** The private key hex — surfaced for the "export key" affordance. */
    privKeyHex: string;
    /** Confirmed balance in sats. */
    confirmedBalance(): Promise<number>;
    /** Confirmed and pending balances from a single `getCoins` call — polling
     * twice a second apart would let them disagree across a confirmation. */
    balances(): Promise<FeeBalances>;
    /**
     * Send every confirmed coin to `address`, leaving the wallet empty.
     *
     * Graph mode always ends with sats stranded here: the funding quote
     * deliberately includes a dust reserve the last CPFP bump must leave as
     * change, so a *successful* exit finishes with a non-empty fee wallet by
     * design. Without this the only way to get them back is to export the
     * bundle and drive the key by hand.
     *
     * Quotes with {@link quoteFeeSweep} and refuses a sweep that is not viable,
     * rather than handing the whole balance to miners for a dust output.
     */
    sweepAll(address: string, feeRate: number): Promise<{ txid: string; amountSats: number }>;
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
    const balances = async (): Promise<FeeBalances> => splitBalances(await wallet.getCoins());
    return {
        address: wallet.address,
        privKeyHex,
        wallet,
        async confirmedBalance() {
            return (await balances()).confirmed;
        },
        balances,
        async sweepAll(address, feeRate) {
            // Re-read rather than trust a polled figure: the panel refreshes on
            // a timer, and sweeping a stale balance would either leave sats
            // behind or ask `send` for more than the wallet holds.
            const coins = (await wallet.getCoins()).filter((c) => c.status.confirmed);
            const quote = quoteFeeSweep({
                balanceSats: coins.reduce((sum, c) => sum + c.value, 0),
                inputCount: coins.length,
                destination: address,
                network,
                feeRate,
            });
            if (!quote.viable) {
                throw new Error(
                    quote.balanceSats === 0
                        ? "Nothing left to recover."
                        : `Too little to recover: ${quote.balanceSats} sats would leave ` +
                              `${quote.amountSats} after fees, under the ${SWEEP_DUST_SATS} sat dust limit.`,
                );
            }
            const txid = await wallet.send({
                address,
                amount: quote.amountSats,
                feeRate,
            });
            return { txid, amountSats: quote.amountSats };
        },
    };
}
