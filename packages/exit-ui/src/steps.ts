import type { ExecutorEvent, ExitStep } from "@arkade-os/sdk";

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
