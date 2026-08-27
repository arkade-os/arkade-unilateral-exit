import {
    EsploraProvider,
    UnilateralExit,
    type ExecutorEvent,
    type ExitPackage,
} from "@arkade-os/sdk";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CopyableHash,
    KIND_LABEL,
    PHASE_STYLE,
    Progress,
    cn,
    loadOrCreateFeeKey,
    makeFeeWallet,
    fundingNeed,
    outstandingFundingSats,
    phaseFor,
    phaseForChainState,
    probeExitProgress,
    stepState,
    type ExitProgress,
    type FeeWalletHandle,
    type StepPhase,
    type TxState,
} from "../index";
import { FundingGate } from "./FundingGate";
import { RecoverRemainder } from "./RecoverRemainder";

type RunPhase = "probing" | "funding" | "running";

export function RunScreen({
    pkg,
    esploraUrl,
    embeddedFeeKeyHex,
    sessionSaved,
    onFeeKeyRegenerated,
    onComplete,
}: {
    pkg: ExitPackage;
    esploraUrl: string;
    /** Fee key carried inside a self-executable bundle; funds the graph-mode CPFP
     * bumps from an already-funded address instead of a freshly generated one. */
    embeddedFeeKeyHex?: string | null;
    /** Fired when the user mints a new fee key, so the caller can persist it.
     * `feeKeyNonce` below is local state and resets on remount, so without this
     * a reload would fall back to the bundle's original key and show the old
     * funding address. */
    onFeeKeyRegenerated?: (newFeeKeyHex: string) => void;
    /** Whether this exit is genuinely recoverable from this browser. False when
     * the save was rejected (quota, blocked storage) — the reassurance must not
     * promise a resume point that does not exist. */
    sessionSaved?: boolean;
    /** Called once when every step finished with no failures. */
    onComplete?: () => void;
}) {
    const graph = pkg.mode === "graph";
    // Graph mode asks the chain first. A resumed exit has usually paid for some
    // of its bumps already, and the gate must not charge for those again — nor
    // show at all when nothing is owed, which is the common case once every
    // unroll is onchain and only the self-paying sweeps remain.
    const [phase, setPhase] = useState<RunPhase>(graph ? "probing" : "running");
    const [fee, setFee] = useState<FeeWalletHandle | null>(null);
    const [feeKeyNonce, setFeeKeyNonce] = useState(0);
    const [feeError, setFeeError] = useState<string | null>(null);
    const [progress, setProgress] = useState<ExitProgress | null>(null);

    const provider = useMemo(() => new EsploraProvider(esploraUrl), [esploraUrl]);

    // Run for both modes: graph needs it to size the gate, and both need it to
    // seed the timeline so already-onchain steps do not render as untouched.
    // `probeExitProgress` never rejects, so there is no failure branch here —
    // a degraded result simply reports nothing as done, which is what this
    // screen assumed before the probe existed.
    useEffect(() => {
        let live = true;
        void probeExitProgress(pkg, provider).then((p) => {
            if (!live) return;
            setProgress(p);
            setPhase((current) =>
                current === "probing"
                    ? outstandingFundingSats(pkg, p) > 0
                        ? "funding"
                        : "running"
                    : current,
            );
        });
        return () => {
            live = false;
        };
    }, [pkg, provider]);

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
        <div className="rounded-[var(--radius-exit)] border border-exit-dead/40 bg-exit-dead/10 p-3 text-sm text-exit-dead">
            Couldn’t prepare the fee wallet: {feeError}
        </div>
    ) : null;

    if (phase === "probing") {
        if (feeError) return feeErrorBanner;
        return <Centered>Checking what is already onchain…</Centered>;
    }

    if (phase === "funding") {
        if (feeError) return feeErrorBanner;
        if (!fee) return <Centered>Preparing fee wallet…</Centered>;
        return (
            <FundingGate
                fee={fee}
                // Only reachable once the probe answered, but falling back to
                // an all-unpaid reading keeps a non-null assertion out of a
                // screen that gates real money.
                need={fundingNeed(pkg, progress ?? { txs: {}, tip: null, degraded: true })}
                pkg={pkg}
                onReady={() => setPhase("running")}
                onRegenerate={(newKey) => {
                    setFeeKeyNonce((n) => n + 1);
                    onFeeKeyRegenerated?.(newKey);
                }}
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
            fee={fee}
            sessionSaved={sessionSaved}
            progress={progress}
            onComplete={onComplete}
        />
    );
}

function ExecutionTimeline({
    pkg,
    provider,
    feeWallet,
    fee,
    sessionSaved,
    progress,
    onComplete,
}: {
    pkg: ExitPackage;
    provider: EsploraProvider;
    feeWallet?: FeeWalletHandle["wallet"];
    /** Graph mode only. Present so the leftover fee sats can be recovered once
     * execution stops — see {@link RecoverRemainder}. */
    fee?: FeeWalletHandle | null;
    sessionSaved?: boolean;
    /** Chain state sampled before execution started. Only ever a fallback for
     * rows the executor has not spoken about — a live event always wins. */
    progress?: ExitProgress | null;
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

    const confirmed = pkg.steps.filter((step, i) => {
        const e = events.get(i);
        // A "skipped" step only counts as onchain when it was already there (no
        // reason); a skip with a reason means its branch failed upstream.
        if (e) return e.status === "confirmed" || (e.status === "skipped" && !e.reason);
        // No event yet: the probe is the only evidence. Counting it keeps the
        // "N / M transactions onchain" line honest from the first render of a
        // resumed exit, instead of starting at 0 and climbing as the executor
        // re-walks work that finished weeks ago.
        return progress ? stepState(step, progress) === "confirmed" : false;
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
                    <div className="flex justify-between text-xs text-exit-ink-dim">
                        <span>
                            {confirmed} / {pkg.steps.length} transactions onchain
                        </span>
                        {failed > 0 && <span className="text-exit-dead">{failed} failed</span>}
                    </div>
                    <Progress
                        value={pct}
                        indicatorClassName={
                            failed ? "bg-exit-dead" : done ? "bg-exit-ok" : "bg-exit-signal"
                        }
                    />
                    {!done &&
                        (sessionSaved ? (
                            <p className="text-[11px] text-exit-ink-faint">
                                Safe to close and reopen — this exit is saved in this browser and
                                execution reads only the blockchain, so it resumes where it left
                                off. Keep your package file to resume anywhere else.
                            </p>
                        ) : (
                            // The save was rejected, so there is no resume point here.
                            // Promising one would be the exact failure this whole
                            // change set exists to remove.
                            <p className="text-[11px] text-exit-wait">
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
                    className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-wait/40 bg-exit-wait/10 p-3 text-xs text-exit-wait"
                >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{w}</span>
                </div>
            ))}

            {fatal && (
                <div className="rounded-[var(--radius-exit)] border border-exit-dead/40 bg-exit-dead/10 p-3 text-sm text-exit-dead">
                    Executor stopped: {fatal}
                </div>
            )}

            {/* Only once the executor has stopped, and for either reason: a
                failed run still leaves its unspent reserve behind, and sweeping
                mid-exit would spend the coins the remaining bumps need. */}
            {fee && (done || fatal) && (
                <RecoverRemainder fee={fee} network={pkg.network} feeRate={pkg.feeRate} />
            )}

            <ol className="flex flex-col">
                {pkg.steps.map((step, i) => (
                    <TimelineRow
                        key={i}
                        index={i}
                        last={i === pkg.steps.length - 1}
                        kindLabel={KIND_LABEL[step.kind]}
                        // Every ExitStep kind carries exactly one identifying
                        // txid: `broadcast` and `sweep` use `txid`, `package`
                        // and `bump` use `parentTxid` (their child is derived).
                        // The cast holds as long as that stays true; a new kind
                        // with neither field would surface here as an empty hash
                        // rather than a crash.
                        txid={
                            "txid" in step ? step.txid : (step as { parentTxid: string }).parentTxid
                        }
                        event={events.get(i)}
                        fallbackState={progress ? stepState(step, progress) : undefined}
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
    fallbackState,
    tipHeight,
}: {
    index: number;
    last: boolean;
    kindLabel: string;
    txid: string;
    event?: ExecutorEvent;
    /** Chain state to show until the executor reaches this step. */
    fallbackState?: TxState;
    tipHeight: number | null;
}) {
    const phase: StepPhase = event
        ? phaseFor(event.status, event.reason)
        : fallbackState
          ? phaseForChainState(fallbackState)
          : "pending";
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
                        "mt-1 flex size-3.5 items-center justify-center rounded-full border-2 bg-exit-field",
                        s.ring,
                    )}
                >
                    <span className={cn("size-1.5 rounded-full", s.dot)} />
                </span>
                {!last && <span className="w-px flex-1 bg-exit-line" />}
            </div>
            <div className="flex flex-1 items-start justify-between gap-3 pb-6">
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-exit-ink">
                        <span className="text-exit-ink-faint font-mono tabular-nums tracking-[-0.01em]">
                            {index + 1}.
                        </span>{" "}
                        {kindLabel}
                    </span>
                    <CopyableHash value={txid} />
                    {event?.reason && (phase === "failed" || phase === "skipped") && (
                        <span
                            className={cn(
                                "text-xs",
                                phase === "failed" ? "text-exit-dead/80" : "text-exit-ink-faint",
                            )}
                        >
                            {event.reason}
                        </span>
                    )}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-xs font-medium", s.text)}>{s.label}</span>
                    {blocksLeft !== null && (
                        <span className="font-mono tabular-nums tracking-[-0.01em] text-[11px] text-exit-wait">
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
            <span className="flex items-center gap-1.5 text-xs text-exit-dead">
                <CircleAlert className="size-3.5" /> stopped
            </span>
        );
    if (!done)
        return (
            <span className="flex items-center gap-1.5 text-xs text-exit-flight">
                <Loader2 className="size-3.5 animate-spin" /> running
            </span>
        );
    if (failed)
        return (
            <span className="flex items-center gap-1.5 text-xs text-exit-dead">
                <CircleAlert className="size-3.5" /> partial
            </span>
        );
    return (
        <span className="flex items-center gap-1.5 text-xs text-exit-ok">
            <CheckCircle2 className="size-3.5" /> done
        </span>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-exit-ink-dim">
            <Loader2 className="size-4 animate-spin" /> {children}
        </div>
    );
}
