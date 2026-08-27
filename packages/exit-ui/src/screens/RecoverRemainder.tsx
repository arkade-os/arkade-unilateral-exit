import { CheckCircle2, CircleAlert, Loader2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CopyableHash,
    quoteFeeSweep,
    type FeeWalletHandle,
} from "../index";
import { formatSats } from "../format";
import type { NetworkName } from "@arkade-os/sdk";

/**
 * Get the leftover fee sats back out of the throwaway wallet.
 *
 * Graph mode always ends with something here: the funding quote includes a dust
 * reserve the final CPFP bump has to leave as change, so even a clean exit
 * finishes with a non-empty fee wallet. Before this panel the only way to
 * recover it was to export the bundle and drive the key by hand — so in
 * practice it was abandoned.
 *
 * Deliberately not shown until execution stops. Sweeping mid-exit would spend
 * the coins the remaining bumps still need, turning a live exit into a stalled
 * one, and the balance shown would be a moving target.
 */
export function RecoverRemainder({
    fee,
    network,
    feeRate,
}: {
    fee: FeeWalletHandle;
    network: NetworkName;
    /** Same rate the exit used; the wallet floors it at its own minimum. */
    feeRate: number;
}) {
    const [balance, setBalance] = useState<number | null>(null);
    const [inputCount, setInputCount] = useState(0);
    const [destination, setDestination] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sweptTxid, setSweptTxid] = useState<string | null>(null);

    // Stop polling once swept: the balance is zero from here and the receipt
    // below is what the user wants left on screen.
    useEffect(() => {
        if (sweptTxid) return;
        let live = true;
        const poll = async () => {
            try {
                const coins = (await fee.wallet.getCoins()).filter((c) => c.status.confirmed);
                if (!live) return;
                setBalance(coins.reduce((s, c) => s + c.value, 0));
                setInputCount(coins.length);
            } catch {
                // Leave the last known figure up; the panel is a convenience and
                // a transient outage should not blank it.
            }
        };
        void poll();
        const id = setInterval(poll, 10_000);
        return () => {
            live = false;
            clearInterval(id);
        };
    }, [fee, sweptTxid]);

    const quote = useMemo(
        () =>
            quoteFeeSweep({
                balanceSats: balance ?? 0,
                inputCount,
                destination,
                network,
                feeRate,
            }),
        [balance, inputCount, destination, network, feeRate],
    );

    if (sweptTxid) {
        return (
            <Card>
                <CardHeader className="flex-row items-center gap-2">
                    <CheckCircle2 className="size-4 text-exit-ok" />
                    <CardTitle>Remainder recovered</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    <p className="text-sm text-exit-ink-dim">
                        Sent to your address. The fee wallet is empty and this exit is finished.
                    </p>
                    <CopyableHash value={sweptTxid} />
                </CardContent>
            </Card>
        );
    }

    // Nothing to offer, and nothing to explain — stay out of the way.
    if (balance === null || balance === 0) return null;

    return (
        <Card>
            <CardHeader className="flex-row items-center gap-2">
                <Wallet className="size-4 text-exit-signal" />
                <CardTitle>Recover the leftover fee sats</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-exit-ink-dim">
                    The throwaway fee wallet still holds{" "}
                    <span className="font-mono tabular-nums tracking-[-0.01em] font-medium text-exit-ink">
                        {formatSats(balance)}
                    </span>
                    . Every graph-mode exit leaves some — the last fee bump has to keep a reserve
                    above the dust limit as change. Send it anywhere you control.
                </p>

                <input
                    value={destination}
                    onChange={(e) => {
                        setDestination(e.target.value);
                        setError(null);
                    }}
                    placeholder="Your onchain address"
                    spellCheck={false}
                    className="w-full rounded-[var(--radius-exit)] border border-exit-line bg-exit-panel/60 p-2.5 font-mono text-xs text-exit-ink focus:border-exit-ink-faint focus:outline-none"
                />

                <div className="flex justify-between text-xs text-exit-ink-dim">
                    <span>After the sweep fee</span>
                    <span className="font-mono tabular-nums tracking-[-0.01em] text-exit-ink">
                        {formatSats(quote.amountSats)}
                    </span>
                </div>

                {!quote.viable && balance > 0 && (
                    <div className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-wait/40 bg-exit-wait/10 p-3 text-xs text-exit-wait">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                        <span>
                            Not worth sweeping: {formatSats(balance)} would leave{" "}
                            {formatSats(quote.amountSats)} after fees, below the dust limit. The
                            whole balance would go to miners.
                        </span>
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-dead/40 bg-exit-dead/10 p-3 text-xs text-exit-dead">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <Button
                    className="self-end"
                    disabled={busy || !destination.trim() || !quote.viable}
                    onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                            const { txid } = await fee.sweepAll(destination.trim(), feeRate);
                            setSweptTxid(txid);
                        } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    {busy ? (
                        <>
                            <Loader2 className="size-3.5 animate-spin" /> Sending…
                        </>
                    ) : (
                        "Recover"
                    )}
                </Button>
            </CardContent>
        </Card>
    );
}
