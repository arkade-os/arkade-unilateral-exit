import type { ExecutorEvent, ExitStep } from "@arkade-os/sdk";
import type { TxState } from "./progress";

export type StepPhase = "pending" | "active" | "confirmed" | "waiting" | "failed" | "skipped";

/** Human labels for each transported step kind. */
export const KIND_LABEL: Record<ExitStep["kind"], string> = {
    broadcast: "Fund splitter",
    package: "Unroll (pre-funded)",
    bump: "Unroll (fee-bumped)",
    sweep: "Sweep to destination",
};

/**
 * Map a live executor status to a display phase. `skipped` is overloaded by the
 * executor: with no reason the step was already onchain (a genuine success), but
 * with a reason it was skipped because its branch failed upstream — so it must
 * NOT render as confirmed.
 */
export function phaseFor(status: ExecutorEvent["status"], reason?: string): StepPhase {
    switch (status) {
        case "confirmed":
            return "confirmed";
        case "skipped":
            return reason ? "skipped" : "confirmed";
        case "failed":
            return "failed";
        case "waiting_csv":
            return "waiting";
        case "warning":
        case "broadcast":
            return "active";
    }
}

/**
 * Display phase for a step the executor has not said anything about yet.
 *
 * It stays silent about more than you would expect. On a resumed exit a step
 * whose transaction is already in the mempool takes the executor's
 * `if (!existing)` branch — no broadcast, therefore no event — and then blocks
 * in `waitConfirmed` until it confirms. With no event the row would render as
 * an untouched "Pending", indistinguishable from a step that never ran, for as
 * long as the transaction takes to confirm. Seeding from the chain probe is
 * what makes a resumed exit look like it is doing something.
 */
export function phaseForChainState(state: TxState): StepPhase {
    switch (state) {
        case "confirmed":
            return "confirmed";
        case "mempool":
            return "active";
        case "pending":
            return "pending";
    }
}

/**
 * Presentation for each phase, against the `--color-exit-*` contract, so it
 * renders in whichever palette the consuming app supplies.
 */
export const PHASE_STYLE: Record<
    StepPhase,
    { dot: string; ring: string; label: string; text: string }
> = {
    pending: {
        dot: "bg-exit-ink-faint",
        ring: "border-exit-line",
        label: "Pending",
        text: "text-exit-ink-faint",
    },
    active: {
        dot: "bg-exit-flight animate-pulse",
        ring: "border-exit-flight",
        label: "In flight",
        text: "text-exit-flight",
    },
    waiting: {
        dot: "bg-exit-wait",
        ring: "border-exit-wait",
        label: "Waiting for timelock",
        text: "text-exit-wait",
    },
    confirmed: {
        dot: "bg-exit-ok",
        ring: "border-exit-ok",
        label: "Confirmed",
        text: "text-exit-ok",
    },
    failed: {
        dot: "bg-exit-dead",
        ring: "border-exit-dead",
        label: "Failed",
        text: "text-exit-dead",
    },
    // Reached only when the executor gave a reason — i.e. the branch failed
    // upstream. Must read as neutral, never as a green success.
    skipped: {
        dot: "bg-exit-ink-faint",
        ring: "border-exit-line",
        label: "Skipped",
        text: "text-exit-ink-faint",
    },
};
