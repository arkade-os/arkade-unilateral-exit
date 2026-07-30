import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "./cn";
import { MONO } from "./mono";

/** Short middle-truncation for txids / addresses, e.g. `a1b2…9f0e`. */
export function truncateMiddle(s: string, head = 8, tail = 6): string {
    if (s.length <= head + tail + 1) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function CopyableHash({
    value,
    className,
    head,
    tail,
    copyOnly,
    label,
}: {
    value: string;
    className?: string;
    head?: number;
    tail?: number;
    /** Copy an untruncatable payload (e.g. a whole bundle JSON): show `label`
     * instead of a middle-truncated hash, and keep the copy icon always visible
     * since there is no hash to hover over. */
    copyOnly?: boolean;
    label?: ReactNode;
}) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            // A full bundle is far too long to be a useful native tooltip.
            title={copyOnly ? undefined : value}
            onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
            }}
            className={cn(
                "group inline-flex items-center gap-1.5 text-xs text-exit-ink-dim transition-colors hover:text-exit-ink",
                !copyOnly && MONO,
                className,
            )}
        >
            <span>{copyOnly ? (label ?? "Copy") : truncateMiddle(value, head, tail)}</span>
            {copied ? (
                <Check className="size-3 text-exit-ok" />
            ) : (
                <Copy className={cn("size-3", !copyOnly && "opacity-0 group-hover:opacity-100")} />
            )}
        </button>
    );
}
