import type { ExitDelay, ExitPackage, ExitVtxoInfo } from "@arkade-os/sdk";
import { AlertTriangle, ArrowRight, ChevronDown, Clock, Eye, Info, Lock } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Tooltip,
    cn,
    esploraUrlFor,
    truncateMiddle,
} from "../index";
import { btc, formatSats } from "../format";

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** A block-based delay is ~10 min/block; a seconds delay is taken as-is. */
function delaySeconds(d: ExitDelay): number {
    return d.type === "blocks" ? d.value * 600 : d.value;
}

/** Rough end-to-end estimate: unroll + splitter + sweep confirmations, plus
 * the longest CSV timelock any VTXO must wait out. Approximate (~10-min blocks). */
function estimateSeconds(pkg: ExitPackage, active: ExitVtxoInfo[]): number {
    const unrollTxs = pkg.steps.filter((s) => s.kind === "package" || s.kind === "bump").length;
    const splitter = pkg.steps.some((s) => s.kind === "broadcast") ? 1 : 0;
    const confirmBlocks = unrollTxs + splitter + 1; // + the final sweep
    const maxDelay = active.reduce((m, v) => (v.delay ? Math.max(m, delaySeconds(v.delay)) : m), 0);
    return confirmBlocks * 600 + maxDelay;
}

function formatDuration(sec: number): string {
    if (sec < 60) return "<1 min";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `~${d}d ${h}h`;
    if (h > 0) return `~${h}h ${m}m`;
    return `~${m}m`;
}

/** Friendly label for a `${contractType}:${pathHint}` exit path. */
function pathLabel(path?: string): string {
    if (!path) return "exit path";
    if (path.startsWith("vhtlc")) return "VHTLC claim";
    if (path.startsWith("default")) return "unilateral exit";
    return path;
}

function delayLabel(d: ExitDelay): string {
    if (d.type === "blocks") return `${d.value}-block timelock`;
    const mins = Math.round(d.value / 60);
    return `~${mins}-min timelock`;
}

// ---------------------------------------------------------------------------

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-exit-ink-faint">{label}</span>
            <span className="font-mono tabular-nums tracking-[-0.01em] text-lg text-exit-ink">
                {value}
            </span>
            {hint && <span className="text-[11px] text-exit-ink-dim">{hint}</span>}
        </div>
    );
}

export function ReviewScreen({
    pkg,
    onContinue,
    esploraOverride,
}: {
    pkg: ExitPackage;
    onContinue: (esploraUrl: string) => void;
    /** Endpoint that wins over the SDK default. Passed in rather than read from
     * `import.meta.env` here: that is Vite's, and this package must not assume a
     * bundler. The host supplies its own build-time value. */
    esploraOverride?: string;
}) {
    const [esplora, setEsplora] = useState(() => esploraUrlFor(pkg.network, esploraOverride));
    const [showAdvanced, setShowAdvanced] = useState(false);
    const active = pkg.vtxos.filter((v) => !v.skipped);
    const skipped = pkg.vtxos.filter((v) => v.skipped);
    const graph = pkg.mode === "graph";

    const exitingValue = active.reduce((s, v) => s + (v.value ?? 0), 0);
    const estimate = useMemo(() => estimateSeconds(pkg, active), [pkg, active]);
    const expired = useMemo(
        () => (pkg.validUntil ? Date.now() / 1000 > pkg.validUntil : false),
        [pkg.validUntil],
    );
    const hasConditionSweep = active.some((v) => v.path?.startsWith("vhtlc"));

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Exit summary</CardTitle>
                    <div className="flex items-center gap-2">
                        <span className="rounded-full border border-exit-line px-2 py-0.5 text-[11px] uppercase tracking-wide text-exit-ink-dim">
                            {pkg.network}
                        </span>
                        <span
                            className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                                graph
                                    ? "bg-exit-flight/15 text-exit-flight"
                                    : "bg-exit-signal/15 text-exit-signal",
                            )}
                        >
                            {graph ? "graph · you fund" : "funded · keyless"}
                        </span>
                    </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                    <Stat
                        label="VTXOs exiting"
                        value={String(active.length)}
                        hint={`${pkg.totals.txCount} transactions`}
                    />
                    <Stat label="Total value" value={formatSats(exitingValue)} />
                    <Stat
                        label="You recover"
                        value={btc(pkg.totals.recoveredSats)}
                        hint={formatSats(pkg.totals.recoveredSats)}
                    />
                    <Stat
                        label="Network fees"
                        value={formatSats(pkg.totals.totalFeeSats)}
                        hint={`${pkg.feeRate} sat/vB`}
                    />
                    <Stat
                        label={graph ? "You send" : "Funding needed"}
                        value={formatSats(pkg.totals.fundingRequiredSats)}
                        hint={graph ? "to a throwaway fee address" : "to the fee wallet"}
                    />
                    <Stat
                        label="Est. time"
                        value={formatDuration(estimate)}
                        hint={
                            <Tooltip content="Approximate: confirmation of each unroll tx (~10-min blocks) plus the longest CSV timelock a VTXO must wait out before its sweep.">
                                <span className="inline-flex items-center gap-1 border-b border-dotted border-exit-ink-faint">
                                    how? <Info className="size-3" />
                                </span>
                            </Tooltip>
                        }
                    />
                </CardContent>
            </Card>

            {expired && (
                <Warning
                    tone="danger"
                    icon={<Clock className="size-4" />}
                    title="Validity window passed"
                >
                    This package’s{" "}
                    <span className="font-mono tabular-nums tracking-[-0.01em]">validUntil</span>{" "}
                    has elapsed. The operator may already have swept some branches. Execution will
                    still try — it is harmless — but some steps may conflict.
                </Warning>
            )}

            {hasConditionSweep && (
                <Warning
                    tone="warn"
                    icon={<Eye className="size-4" />}
                    title="Contains condition witnesses"
                >
                    A sweep spends a contract path (e.g. a VHTLC preimage). That secret is embedded
                    in the pre-signed transaction — treat this package as confidential until every
                    step is broadcast.
                </Warning>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Destination</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-exit-ink-dim">
                        Sweep address
                        <Tooltip content="Fixed at package creation. The sweep transactions are pre-signed to this address, so it can't be changed here.">
                            <Lock className="size-3.5" />
                        </Tooltip>
                    </span>
                    <span
                        className="font-mono tabular-nums tracking-[-0.01em] text-xs text-exit-ink"
                        title={pkg.sweepAddress}
                    >
                        {truncateMiddle(pkg.sweepAddress, 12, 10)}
                    </span>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>VTXOs being exited</CardTitle>
                    <span className="text-xs text-exit-ink-dim">
                        {active.length} ·{" "}
                        <span className="font-mono tabular-nums tracking-[-0.01em]">
                            {formatSats(exitingValue)}
                        </span>
                    </span>
                </CardHeader>
                <CardContent>
                    <div className="divide-y divide-exit-line rounded-[var(--radius-exit)] border border-exit-line">
                        {active.map((v) => (
                            <div
                                key={v.outpoint}
                                className="flex items-center justify-between gap-3 p-3"
                            >
                                <Tooltip content={`VTXO outpoint (txid:vout): ${v.outpoint}`}>
                                    <span className="font-mono tabular-nums tracking-[-0.01em] text-xs text-exit-ink-dim">
                                        {truncateMiddle(v.outpoint, 10, 8)}
                                    </span>
                                </Tooltip>
                                <div className="flex items-center gap-2 text-xs">
                                    {v.path && (
                                        <Tooltip content="The tapscript path this VTXO is spent through onchain.">
                                            <span className="rounded bg-exit-panel-2 px-1.5 py-0.5 text-exit-ink-dim">
                                                {pathLabel(v.path)}
                                            </span>
                                        </Tooltip>
                                    )}
                                    {v.delay && (
                                        <Tooltip content="The sweep becomes spendable only after this relative timelock elapses from its exit tx confirming.">
                                            <span className="rounded bg-exit-panel-2 px-1.5 py-0.5 text-exit-ink-dim">
                                                {delayLabel(v.delay)}
                                            </span>
                                        </Tooltip>
                                    )}
                                    <span className="font-mono tabular-nums tracking-[-0.01em] text-exit-ink">
                                        {formatSats(v.value ?? 0)}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {skipped.map((v) => (
                            <div
                                key={v.outpoint}
                                className="flex items-center justify-between gap-3 p-3 opacity-60"
                            >
                                <span
                                    className="font-mono tabular-nums tracking-[-0.01em] text-xs text-exit-ink-faint"
                                    title={v.outpoint}
                                >
                                    {truncateMiddle(v.outpoint, 10, 8)}
                                </span>
                                <span className="text-xs text-exit-dead/80">
                                    skipped · {v.skipped}
                                </span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
                <button
                    onClick={() => setShowAdvanced((s) => !s)}
                    className="inline-flex w-fit items-center gap-1 text-xs text-exit-ink-dim transition-colors hover:text-exit-ink"
                >
                    <ChevronDown
                        className={cn(
                            "size-3.5 transition-transform",
                            showAdvanced && "rotate-180",
                        )}
                    />
                    Advanced settings
                </button>
                {showAdvanced && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Esplora endpoint</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2">
                            <input
                                value={esplora}
                                onChange={(e) => setEsplora(e.target.value)}
                                spellCheck={false}
                                className="w-full rounded-[var(--radius-exit)] border border-exit-line bg-exit-panel/60 p-2.5 font-mono text-xs text-exit-ink focus:border-exit-ink-faint focus:outline-none"
                            />
                            <p className="text-[11px] text-exit-ink-dim">
                                Defaults to the SDK endpoint for{" "}
                                <span className="font-mono tabular-nums tracking-[-0.01em]">
                                    {pkg.network}
                                </span>
                                . Override only if you run your own — must be CORS-permissive and
                                expose{" "}
                                <span className="font-mono tabular-nums tracking-[-0.01em]">
                                    /txs/package
                                </span>
                                .
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            <Button
                size="lg"
                className="self-end"
                disabled={active.length === 0 || !esplora.trim()}
                onClick={() => onContinue(esplora.trim())}
            >
                {graph ? "Set up funding" : "Begin execution"}
                <ArrowRight />
            </Button>
        </div>
    );
}

function Warning({
    tone,
    icon,
    title,
    children,
}: {
    tone: "warn" | "danger";
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className={cn(
                "flex items-start gap-2.5 rounded-[var(--radius-exit)] border p-3 text-sm",
                tone === "danger"
                    ? "border-exit-dead/40 bg-exit-dead/10 text-exit-dead"
                    : "border-exit-wait/40 bg-exit-wait/10 text-exit-wait",
            )}
        >
            <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="size-4" />}</span>
            <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-xs opacity-90">{children}</p>
            </div>
        </div>
    );
}
