import {
    EsploraProvider,
    UnilateralExit,
    type ExecutorEvent,
    type ExitPackage,
} from "@arkade-os/sdk";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadOrCreateFeeKey, makeFeeWallet, type FeeWalletHandle } from "@/lib/feeWallet";
import { KIND_LABEL, PHASE_STYLE, phaseFor, type StepPhase } from "@/components/stepMeta";
import { CopyableHash } from "@/components/CopyableHash";
import { FundingGate } from "@/components/FundingGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type RunPhase = "funding" | "running";

export function RunScreen({
    pkg,
    esploraUrl,
    embeddedFeeKeyHex,
    sessionSaved,
    onComplete,
}: {
    pkg: ExitPackage;
    esploraUrl: string;
    /** Fee key carried inside a self-executable bundle; funds the graph-mode CPFP
     * bumps from an already-funded address instead of a freshly generated one. */
    embeddedFeeKeyHex?: string | null;
    /** Whether this exit is genuinely recoverable from this browser. False when
     * the save was rejected (quota, blocked storage) — the reassurance must not
     * promise a resume point that does not exist. */
    sessionSaved?: boolean;
    /** Called once when every step finished with no failures. */
    onComplete?: () => void;
}) {
    const graph = pkg.mode === "graph";
    // Graph mode always shows the funding gate — even with an embedded fee key it
    // stays visible so the fee address is never hidden and the balance is
    // confirmed before broadcasting (an embedded key just pre-funds it).
    const [phase, setPhase] = useState<RunPhase>(graph ? "funding" : "running");
    const [fee, setFee] = useState<FeeWalletHandle | null>(null);
    const [feeKeyNonce, setFeeKeyNonce] = useState(0);
    const [feeError, setFeeError] = useState<string | null>(null);

    const provider = useMemo(() => new EsploraProvider(esploraUrl), [esploraUrl]);

    // Build the ephemeral fee wallet for graph mode.
    useEffect(() => {
        if (!graph) return;
        let live = true;
        setFeeError(null);
        // A regenerated key must not be overridden by the bundle's embedded one.
        const privKey =
            feeKeyNonce === 0 ? (embeddedFeeKeyHex ?? loadOrCreateFeeKey()) : loadOrCreateFeeKey();
        // Network comes from the package itself, not any connected server.
        makeFeeWallet(privKey, pkg.network, esploraUrl)
            .then((f) => {
                if (live) setFee(f);
            })
            .catch((e) => {
                if (live) setFeeError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            live = false;
        };
    }, [graph, pkg.network, esploraUrl, embeddedFeeKeyHex, feeKeyNonce]);

    const feeErrorBanner = feeError ? (
        <div className="rounded-[var(--radius)] border border-dead/40 bg-dead/10 p-3 text-sm text-dead">
            Couldn’t prepare the fee wallet: {feeError}
        </div>
    ) : null;

    if (phase === "funding") {
        if (feeError) return feeErrorBanner;
        if (!fee) return <Centered>Preparing fee wallet…</Centered>;
        return (
            <FundingGate
                fee={fee}
                required={pkg.totals.fundingRequiredSats}
                pkg={pkg}
                onReady={() => setPhase("running")}
                onRegenerate={() => setFeeKeyNonce((n) => n + 1)}
            />
        );
    }

    // Graph mode always needs its fee wallet before the executor can bump anchors.
    if (graph && !fee)
        return feeError ? feeErrorBanner : <Centered>Preparing fee wallet…</Centered>;

    return (
        <ExecutionTimeline
            pkg={pkg}
            provider={provider}
            feeWallet={fee?.wallet}
            sessionSaved={sessionSaved}
            onComplete={onComplete}
        />
    );
}

function ExecutionTimeline({
    pkg,
    provider,
    feeWallet,
    sessionSaved,
    onComplete,
}: {
    pkg: ExitPackage;
    provider: EsploraProvider;
    feeWallet?: FeeWalletHandle["wallet"];
    sessionSaved?: boolean;
    onComplete?: () => void;
}) {
    const [events, setEvents] = useState<Map<number, ExecutorEvent>>(new Map());
    const [warnings, setWarnings] = useState<string[]>([]);
    const [done, setDone] = useState(false);
    const [fatal, setFatal] = useState<string | null>(null);
    const [tipHeight, setTipHeight] = useState<number | null>(null);

    useEffect(() => {
        const executor = new UnilateralExit.Executor(pkg, provider, {
            feeWallet,
            pollIntervalMs: 4000,
        });
        const iterator = executor[Symbol.asyncIterator]();
        let cancelled = false;
        (async () => {
            try {
                for (let r = await iterator.next(); !r.done; r = await iterator.next()) {
                    if (cancelled) return;
                    const ev = r.value;
                    if (ev.stepIndex < 0) {
                        if (ev.reason) setWarnings((w) => [...w, ev.reason!]);
                        continue;
                    }
                    setEvents((prev) => new Map(prev).set(ev.stepIndex, ev));
                }
                if (!cancelled) setDone(true);
            } catch (e) {
                if (!cancelled) setFatal(e instanceof Error ? e.message : String(e));
            }
        })();
        // Unmount (e.g. "Start over") must stop the executor — otherwise the
        // detached loop keeps polling and broadcasting the remaining steps in the
        // background. Returning the async iterator halts the generator at its next
        // suspension point; idempotency makes an in-flight step safe to re-run.
        return () => {
            cancelled = true;
            void iterator.return?.(undefined);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Poll chain tip while any sweep is waiting, to show a live block countdown.
    const anyWaiting = [...events.values()].some((e) => e.status === "waiting_csv");
    useEffect(() => {
        if (!anyWaiting) return;
        let live = true;
        const poll = async () => {
            try {
                const tip = await provider.getChainTip();
                if (live) setTipHeight(tip.height);
            } catch {
                /* ignore */
            }
        };
        void poll();
        const id = setInterval(poll, 5000);
        return () => {
            live = false;
            clearInterval(id);
        };
    }, [anyWaiting, provider]);

    const confirmed = pkg.steps.filter((_, i) => {
        const e = events.get(i);
        // A "skipped" step only counts as onchain when it was already there (no
        // reason); a skip with a reason means its branch failed upstream.
        return e?.status === "confirmed" || (e?.status === "skipped" && !e.reason);
    }).length;
    const failed = [...events.values()].filter((e) => e.status === "failed").length;
    const pct = pkg.steps.length ? (confirmed / pkg.steps.length) * 100 : 0;

    // Report a clean finish so the caller can drop the saved session. Failures
    // are deliberately not reported — a failed exit stays saved so it can be
    // retried. `done` only flips once, so this fires at most once.
    useEffect(() => {
        if (done && failed === 0) onComplete?.();
    }, [done, failed, onComplete]);

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>
                        {fatal
                            ? "Execution stopped"
                            : done
                              ? failed
                                  ? "Finished with failures"
                                  : "Exit complete"
                              : "Executing exit"}
                    </CardTitle>
                    <StatusPill done={done} failed={failed} fatal={!!fatal} />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs text-ink-dim">
                        <span>
                            {confirmed} / {pkg.steps.length} transactions onchain
                        </span>
                        {failed > 0 && <span className="text-dead">{failed} failed</span>}
                    </div>
                    <Progress
                        value={pct}
                        indicatorClassName={failed ? "bg-dead" : done ? "bg-ok" : "bg-signal"}
                    />
                    {!done &&
                        (sessionSaved ? (
                            <p className="text-[11px] text-ink-faint">
                                Safe to close and reopen — this exit is saved in this browser and
                                execution reads only the blockchain, so it resumes where it left
                                off. Keep your package file to resume anywhere else.
                            </p>
                        ) : (
                            // The save was rejected, so there is no resume point here.
                            // Promising one would be the exact failure this whole
                            // change set exists to remove.
                            <p className="text-[11px] text-wait">
                                This browser could not save a resume point — keep your package file,
                                you will need it to continue. Execution reads only the blockchain,
                                so re-importing resumes where it left off.
                            </p>
                        ))}
                </CardContent>
            </Card>

            {warnings.map((w, i) => (
                <div
                    key={i}
                    className="flex items-start gap-2 rounded-[var(--radius)] border border-wait/40 bg-wait/10 p-3 text-xs text-wait"
                >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{w}</span>
                </div>
            ))}

            {fatal && (
                <div className="rounded-[var(--radius)] border border-dead/40 bg-dead/10 p-3 text-sm text-dead">
                    Executor stopped: {fatal}
                </div>
            )}

            <ol className="flex flex-col">
                {pkg.steps.map((step, i) => (
                    <TimelineRow
                        key={i}
                        index={i}
                        last={i === pkg.steps.length - 1}
                        kindLabel={KIND_LABEL[step.kind]}
                        txid={
                            "txid" in step ? step.txid : (step as { parentTxid: string }).parentTxid
                        }
                        event={events.get(i)}
                        tipHeight={tipHeight}
                    />
                ))}
            </ol>
        </div>
    );
}

function TimelineRow({
    index,
    last,
    kindLabel,
    txid,
    event,
    tipHeight,
}: {
    index: number;
    last: boolean;
    kindLabel: string;
    txid: string;
    event?: ExecutorEvent;
    tipHeight: number | null;
}) {
    const phase: StepPhase = event ? phaseFor(event.status, event.reason) : "pending";
    const s = PHASE_STYLE[phase];
    const blocksLeft =
        event?.status === "waiting_csv" && event.maturesAtHeight && tipHeight !== null
            ? Math.max(0, event.maturesAtHeight - tipHeight)
            : null;

    return (
        <li className="flex gap-3">
            <div className="flex flex-col items-center">
                <span
                    className={cn(
                        "mt-1 flex size-3.5 items-center justify-center rounded-full border-2 bg-field",
                        s.ring,
                    )}
                >
                    <span className={cn("size-1.5 rounded-full", s.dot)} />
                </span>
                {!last && <span className="w-px flex-1 bg-line" />}
            </div>
            <div className="flex flex-1 items-start justify-between gap-3 pb-6">
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-ink">
                        <span className="text-ink-faint tabular">{index + 1}.</span> {kindLabel}
                    </span>
                    <CopyableHash value={txid} />
                    {event?.reason && (phase === "failed" || phase === "skipped") && (
                        <span
                            className={cn(
                                "text-xs",
                                phase === "failed" ? "text-dead/80" : "text-ink-faint",
                            )}
                        >
                            {event.reason}
                        </span>
                    )}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-xs font-medium", s.text)}>{s.label}</span>
                    {blocksLeft !== null && (
                        <span className="tabular text-[11px] text-wait">
                            ~{blocksLeft} block{blocksLeft === 1 ? "" : "s"} left
                        </span>
                    )}
                </div>
            </div>
        </li>
    );
}

function StatusPill({ done, failed, fatal }: { done: boolean; failed: number; fatal: boolean }) {
    if (fatal)
        return (
            <span className="flex items-center gap-1.5 text-xs text-dead">
                <CircleAlert className="size-3.5" /> stopped
            </span>
        );
    if (!done)
        return (
            <span className="flex items-center gap-1.5 text-xs text-flight">
                <Loader2 className="size-3.5 animate-spin" /> running
            </span>
        );
    if (failed)
        return (
            <span className="flex items-center gap-1.5 text-xs text-dead">
                <CircleAlert className="size-3.5" /> partial
            </span>
        );
    return (
        <span className="flex items-center gap-1.5 text-xs text-ok">
            <CheckCircle2 className="size-3.5" /> done
        </span>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-dim">
            <Loader2 className="size-4 animate-spin" /> {children}
        </div>
    );
}
