import type { StepPhase } from "@arkade-os/exit-ui";

/**
 * Presentation for each step phase, in this app's own palette. Deliberately NOT
 * part of `@arkade-os/exit-ui`: the phase *mapping* is shared logic, but these
 * are Tailwind class strings and belong to whichever app is rendering.
 */
export const PHASE_STYLE: Record<
    StepPhase,
    { dot: string; ring: string; label: string; text: string }
> = {
    pending: { dot: "bg-ink-faint", ring: "border-line", label: "Pending", text: "text-ink-faint" },
    active: {
        dot: "bg-flight pulse",
        ring: "border-flight",
        label: "In flight",
        text: "text-flight",
    },
    waiting: {
        dot: "bg-wait",
        ring: "border-wait",
        label: "Waiting for timelock",
        text: "text-wait",
    },
    confirmed: { dot: "bg-ok", ring: "border-ok", label: "Confirmed", text: "text-ok" },
    failed: { dot: "bg-dead", ring: "border-dead", label: "Failed", text: "text-dead" },
    // Reached only when the executor gave a reason — i.e. the branch failed
    // upstream. Must read as neutral, never as a green success.
    skipped: {
        dot: "bg-ink-faint",
        ring: "border-line",
        label: "Skipped",
        text: "text-ink-faint",
    },
};
