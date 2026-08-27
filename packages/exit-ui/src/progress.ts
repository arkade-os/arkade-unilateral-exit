import type { ExitPackage, ExitStep } from "@arkade-os/sdk";

/**
 * What the chain says about one transaction.
 *
 * `pending` deliberately conflates "never broadcast" with "we could not find
 * out": `EsploraProvider.getTxStatus` throws for a 404 and for a 429 alike, so
 * the two are not distinguishable through that interface. Conflating them is
 * safe *only* because nothing here treats `pending` as good news — it never
 * reduces the funding still owed and never counts as progress. When a lookup
 * fails outright the summary carries `degraded`, so the UI can say so rather
 * than present a confident under-count.
 */
export type TxState = "confirmed" | "mempool" | "pending";

export interface TxFacts {
    state: TxState;
    /** Present only when confirmed. Starts the CSV clock for dependent sweeps. */
    blockHeight?: number;
    blockTime?: number;
}

/**
 * The slice of the onchain provider this module needs. Injectable so tests need
 * no network — the same reasoning as `SessionStore` in `session.ts`.
 * `EsploraProvider` satisfies it structurally.
 */
export interface ChainReader {
    getTxStatus(
        txid: string,
    ): Promise<{ confirmed: boolean; blockHeight?: number; blockTime?: number }>;
    getChainTip(): Promise<{ height: number; time: number }>;
}

export interface ExitProgress {
    /** Keyed by txid, not step index: sweeps ask about their dependency, which
     * is another step's anchor, so one lookup serves both. */
    txs: Record<string, TxFacts>;
    /** Null when the tip could not be read; maturity is then unknowable. */
    tip: { height: number; time: number } | null;
    /**
     * The endpoint did not look healthy while probing, so a `pending` state may
     * mean "could not tell" rather than "not broadcast".
     *
     * Derived from the chain tip rather than from failed status lookups. A
     * lookup failure on its own proves nothing: `getTxStatus` throws the same
     * way for a 404 as for a 429, and on a package that has not started *every*
     * step 404s — so keying off failures would raise this on every fresh import
     * and train the user to ignore it. If `/blocks` answered, the endpoint was
     * serving us and those 404s are real.
     */
    degraded: boolean;
}

/**
 * The txid a step is keyed on. Mirrors the executor exactly (`broadcast` and
 * `sweep` carry `txid`; `package` and `bump` carry `parentTxid`) so this module
 * and the executor can never disagree about which transaction a step *is*.
 */
export function anchorTxidFor(step: ExitStep): string {
    return "txid" in step ? step.txid : step.parentTxid;
}

export function stepState(step: ExitStep, progress: ExitProgress): TxState {
    return progress.txs[anchorTxidFor(step)]?.state ?? "pending";
}

/**
 * Graph-mode fee sats still owed to the fee address.
 *
 * `fundingRequiredSats` is the sum of every `bump` step's CPFP fee, frozen when
 * the package was built (SDK: `fundingRequiredSats: graph ? stepFees : …`), and
 * the per-step split is not transported. So this apportions the total evenly
 * across bump steps and charges only for those not yet paid for.
 *
 * A bump already in the mempool has *had* its fee spent — the CPFP child is
 * built and broadcast — so only a `pending` bump still costs anything.
 *
 * Even apportionment is exact when every unroll parent has the same shape, and
 * an approximation otherwise; it rounds up so the estimate errs towards asking
 * for slightly too much rather than opening the gate on an underfunded wallet.
 * Returns 0 for `funded` packages: their fees were locked into the splitter at
 * prepare time and the executor needs no wallet at all.
 */
export function outstandingFundingSats(pkg: ExitPackage, progress: ExitProgress): number {
    if (pkg.mode !== "graph") return 0;
    const bumps = pkg.steps.filter((s) => s.kind === "bump");
    if (bumps.length === 0) return 0;
    const unpaid = bumps.filter((s) => stepState(s, progress) === "pending").length;
    if (unpaid === 0) return 0;
    return Math.ceil((pkg.totals.fundingRequiredSats * unpaid) / bumps.length);
}

/**
 * Whether a sweep's relative timelock has elapsed, so it could be broadcast now.
 *
 * Mirrors the executor's own maturity check: the CSV clock starts when the
 * VTXO-creating tx confirms, and is compared against the chain tip in blocks or
 * in median-time-past seconds depending on the delay type.
 */
export function isSweepMature(step: ExitStep, progress: ExitProgress): boolean {
    if (step.kind !== "sweep" || !progress.tip) return false;
    const dep = progress.txs[step.dependsOnTxid];
    if (dep?.state !== "confirmed") return false;
    return step.delay.type === "blocks"
        ? progress.tip.height >= (dep.blockHeight ?? 0) + step.delay.value
        : progress.tip.time >= (dep.blockTime ?? 0) + step.delay.value;
}

export interface ExitProgressSummary {
    /** Steps whose transaction is confirmed onchain. */
    confirmed: number;
    /** Steps whose transaction is in the mempool, waiting to confirm. */
    inFlight: number;
    total: number;
    /** Any work at all has already happened, so this is a resumed exit rather
     * than a fresh one. Drives the "in progress" card and the CTA wording. */
    isInProgress: boolean;
    /** Every step is confirmed — there is nothing left to execute. */
    isComplete: boolean;
    /** Graph-mode fee sats still owed; 0 when the gate should be skipped. */
    outstandingFundingSats: number;
    /** Sats recoverable by sweeps that are matured but not yet confirmed —
     * i.e. value that would land on the next run, with no waiting. */
    sweepableSats: number;
    /** A lookup failed, so the counts above may under-report. */
    degraded: boolean;
}

export function summarizeExitProgress(
    pkg: ExitPackage,
    progress: ExitProgress,
): ExitProgressSummary {
    let confirmed = 0;
    let inFlight = 0;
    let sweepableSats = 0;
    for (const step of pkg.steps) {
        const state = stepState(step, progress);
        if (state === "confirmed") confirmed++;
        else if (state === "mempool") inFlight++;
        if (step.kind === "sweep" && state !== "confirmed" && isSweepMature(step, progress)) {
            sweepableSats += pkg.vtxos.find((v) => v.outpoint === step.vtxo)?.value ?? 0;
        }
    }
    return {
        confirmed,
        inFlight,
        total: pkg.steps.length,
        isInProgress: confirmed > 0 || inFlight > 0,
        isComplete: pkg.steps.length > 0 && confirmed === pkg.steps.length,
        outstandingFundingSats: outstandingFundingSats(pkg, progress),
        sweepableSats,
        degraded: progress.degraded,
    };
}

/**
 * What the button at the end of the review screen should say.
 *
 * Pure, and tested, because the wording is load-bearing: "Set up funding" on an
 * exit that needs no more funding sends the user off to deposit sats it will
 * never spend, and "Begin execution" on a half-finished exit misrepresents what
 * is about to happen — the executor resumes, it cannot start over.
 *
 * `null` for `summary` means the probe has not answered yet, in which case the
 * package's own declared mode is all there is to go on.
 */
export function ctaLabelFor(pkg: ExitPackage, summary: ExitProgressSummary | null): string {
    if (summary?.isComplete) return "Verify completion";
    const graph = pkg.mode === "graph";
    // A degraded probe under-reports progress, so trust it to *add* funding but
    // never to remove the gate: falling through to "Set up funding" merely
    // shows a gate that opens immediately once the balance is seen.
    if (graph && (summary === null || summary.outstandingFundingSats > 0)) return "Set up funding";
    return summary?.isInProgress ? "Resume exit" : "Begin execution";
}

/**
 * Ask the chain what has already happened.
 *
 * Reads every step's anchor plus every sweep's dependency — deduplicated,
 * because in a graph package a sweep's `dependsOnTxid` is usually some bump's
 * `parentTxid`, so the naive version would query each twice.
 *
 * Never throws: a probe is an optimisation over "assume nothing is done", so a
 * flaky endpoint must degrade to that rather than block the user from running
 * their exit. Individual failures set `degraded`.
 */
export async function probeExitProgress(
    pkg: ExitPackage,
    reader: ChainReader,
): Promise<ExitProgress> {
    const wanted = new Set<string>();
    for (const step of pkg.steps) {
        wanted.add(anchorTxidFor(step));
        if (step.kind === "sweep") wanted.add(step.dependsOnTxid);
    }

    const txs: Record<string, TxFacts> = {};
    // The tip doubles as the endpoint health check, so it rides along with the
    // status lookups rather than waiting behind them.
    const [tip] = await Promise.all([
        reader.getChainTip().catch(() => null),
        ...[...wanted].map(async (txid) => {
            try {
                const s = await reader.getTxStatus(txid);
                txs[txid] = s.confirmed
                    ? { state: "confirmed", blockHeight: s.blockHeight, blockTime: s.blockTime }
                    : { state: "mempool" };
            } catch {
                // Indistinguishable here from a rate-limited or broken endpoint;
                // `degraded` decides which reading the UI should present.
                txs[txid] = { state: "pending" };
            }
        }),
    ]);

    // Without a tip nothing can be shown as mature and no 404 can be trusted as
    // meaning "not broadcast" — one flag covers both.
    return { txs, tip, degraded: tip === null };
}
