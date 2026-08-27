import type { ExitPackage } from "@arkade-os/sdk";
import { Check, CircleAlert, Copy, Download, Loader2, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CopyableHash,
    Progress,
    encodeExitBundle,
    resetFeeKey,
    type FeeBalances,
    type FeeWalletHandle,
    type FundingNeed,
} from "../index";
import { formatSats } from "../format";

function downloadText(filename: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // Firefox only triggers a programmatic download when the anchor is in the
    // document; defer the revoke so the browser can read the blob first.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Graph-mode funding gate: the browser owns a throwaway fee key; the user
 * sends fee sats to its address and we proceed once the deposit confirms.
 * The exit can also be exported as a self-executable bundle carrying that fee
 * key, so another machine can run it against the already-funded address.
 */
export function FundingGate({
    fee,
    need,
    pkg,
    onReady,
    onRegenerate,
}: {
    fee: FeeWalletHandle;
    /** What the wallet must hold, broken down, so the figure can explain itself
     * — it is neither the package's quote nor a plain sum of fees. */
    need: FundingNeed;
    pkg: ExitPackage;
    onReady: () => void;
    /** Receives the newly minted key. It must be carried back up, not just
     * signalled: a self-executable bundle stores its fee key in the session, and
     * a stale one there would restore the *old* funding address after a reload —
     * stranding whatever was deposited to the new one. */
    onRegenerate: (newFeeKeyHex: string) => void;
}) {
    const [{ confirmed: balance, pending }, setBalances] = useState<FeeBalances>({
        confirmed: 0,
        pending: 0,
    });
    const [copied, setCopied] = useState(false);
    const [unreachable, setUnreachable] = useState(false);

    useEffect(() => {
        let live = true;
        let failures = 0;
        const poll = async () => {
            try {
                const b = await fee.balances();
                if (!live) return;
                setBalances(b);
                failures = 0;
                setUnreachable(false);
            } catch {
                // Tolerate transient hiccups, but after a few consecutive failures
                // surface the outage — otherwise "can't reach the endpoint" is
                // indistinguishable from "deposit not seen yet" and the user waits
                // forever (or re-sends fees).
                failures += 1;
                if (live && failures >= 3) setUnreachable(true);
            }
        };
        void poll();
        const id = setInterval(poll, 5000);
        return () => {
            live = false;
            clearInterval(id);
        };
    }, [fee]);

    const required = need.requiredSats;
    const funded = balance >= required;
    const pct = Math.min(100, required > 0 ? (balance / required) * 100 : 0);
    const paidBumps = need.totalBumps - need.unpaidBumps;
    // Serializing the whole pre-signed graph on every 5s balance poll is pure
    // waste; the bundle only changes when the package or the fee key does.
    const bundle = useMemo(() => encodeExitBundle(pkg, fee.privKeyHex), [pkg, fee.privKeyHex]);

    return (
        <Card>
            <CardHeader className="flex-row items-center gap-2">
                <Wallet className="size-4 text-exit-signal" />
                <CardTitle>Fund the exit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-exit-ink-dim">
                    Send at least{" "}
                    <span className="font-mono tabular-nums tracking-[-0.01em] font-medium text-exit-ink">
                        {formatSats(required)}
                    </span>{" "}
                    to this throwaway fee address. It only ever holds fee sats — never your exited
                    funds — and lives in this browser. Change comes back to it.
                </p>

                {/* The figure matches neither the package's quote nor a bare sum
                    of fees, so it has to account for itself: the executor's
                    anchor-child builder rejects change under 546 sats, and a
                    wallet holding exactly the fees cannot pay the last one. */}
                <ul className="flex flex-col gap-1 text-xs text-exit-ink-dim">
                    <li className="flex justify-between gap-3">
                        <span>
                            Fees for {need.unpaidBumps} of {need.totalBumps} unrolls
                            {paidBumps > 0 && (
                                <span className="text-exit-ok">
                                    {" "}
                                    ({paidBumps} already onchain and paid for)
                                </span>
                            )}
                        </span>
                        <span className="font-mono tabular-nums tracking-[-0.01em] shrink-0">
                            {formatSats(need.feesSats)}
                        </span>
                    </li>
                    <li className="flex justify-between gap-3">
                        <span>
                            Reserve the last unroll must leave as change — it stays in this wallet,
                            not spent
                        </span>
                        <span className="font-mono tabular-nums tracking-[-0.01em] shrink-0">
                            {formatSats(need.reserveSats)}
                        </span>
                    </li>
                </ul>

                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-exit)] border border-exit-line bg-exit-panel-2/60 p-3">
                    <span className="font-mono tabular-nums tracking-[-0.01em] break-all text-xs text-exit-ink">
                        {fee.address}
                    </span>
                    <button
                        type="button"
                        onClick={async () => {
                            await navigator.clipboard.writeText(fee.address);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1200);
                        }}
                        className="shrink-0 text-exit-ink-dim hover:text-exit-ink"
                        title="Copy address"
                    >
                        {copied ? (
                            <Check className="size-4 text-exit-ok" />
                        ) : (
                            <Copy className="size-4" />
                        )}
                    </button>
                </div>

                <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                        <span className="text-exit-ink-dim">Received (confirmed)</span>
                        <span className="font-mono tabular-nums tracking-[-0.01em] text-exit-ink">
                            {formatSats(balance)} / {formatSats(required)}
                        </span>
                    </div>
                    <Progress
                        value={pct}
                        indicatorClassName={funded ? "bg-exit-ok" : "bg-exit-signal"}
                    />
                    {/* Without this a deposit sitting in the mempool is invisible
                        here, which reads exactly like one that never arrived —
                        and the natural response to that is to send more. */}
                    {pending > 0 && (
                        <div className="flex items-start gap-2 text-[11px] text-exit-wait">
                            <Loader2 className="mt-px size-3 shrink-0 animate-spin" />
                            <span>
                                <span className="font-mono tabular-nums tracking-[-0.01em]">
                                    {formatSats(pending)}
                                </span>{" "}
                                seen, waiting to confirm — no need to send more. Fee bumps can only
                                spend confirmed coins, so this unlocks on its own once it lands in a
                                block.
                                {balance + pending >= required && (
                                    <span className="text-exit-ok">
                                        {" "}
                                        That will be enough to proceed.
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                </div>

                {unreachable && (
                    <div className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-wait/40 bg-exit-wait/10 p-3 text-xs text-exit-wait">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                        <span>
                            Can’t reach the Esplora endpoint to check the balance — still retrying.
                            If this persists, verify the endpoint in Review → Advanced settings.
                        </span>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                                downloadText(`arkade-exit-${pkg.createdAt}.json`, bundle)
                            }
                            title="Download this exit with its fee key embedded, so another machine can run it standalone"
                        >
                            <Download className="size-3.5" /> Export package
                        </Button>
                        <CopyableHash value={bundle} copyOnly label="Copy" />
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onRegenerate(resetFeeKey())}
                            title="Discard this fee key and generate a new one"
                        >
                            <RefreshCw className="size-3.5" /> New key
                        </Button>
                    </div>
                    <Button disabled={!funded} onClick={onReady}>
                        {funded ? "Proceed" : "Waiting for deposit…"}
                    </Button>
                </div>

                <p className="text-[11px] text-exit-ink-faint">
                    Export produces a self-executable bundle with the fee key embedded — the
                    graph-mode equivalent of a fully-signed package. Keep it private: anyone holding
                    it can spend the small fee remainder.
                </p>
            </CardContent>
        </Card>
    );
}
