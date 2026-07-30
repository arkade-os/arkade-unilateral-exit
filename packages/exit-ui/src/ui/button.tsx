import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./cn";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-exit)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-exit-signal/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                // The hairline ring is derived from the accent via color-mix so it
                // follows the consuming app's palette. It was previously a
                // hardcoded rgba() of this app's amber, which would have rendered
                // an amber ring on any other theme.
                default:
                    "bg-exit-signal text-exit-signal-ink hover:bg-exit-signal/90 font-semibold shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-exit-signal)_25%,transparent)]",
                outline:
                    "border border-exit-line bg-transparent text-exit-ink hover:bg-exit-panel-2 hover:border-exit-ink-faint",
                ghost: "text-exit-ink-dim hover:bg-exit-panel-2 hover:text-exit-ink",
                danger: "border border-exit-dead/40 text-exit-dead hover:bg-exit-dead/10",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-8 px-3 text-xs",
                lg: "h-12 px-6 text-base",
                icon: "h-9 w-9",
            },
        },
        defaultVariants: { variant: "default", size: "default" },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        );
    },
);
Button.displayName = "Button";
