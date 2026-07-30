import type { ExitPackage } from "@arkade-os/sdk";
import { FileUp, ShieldAlert, Trash2 } from "lucide-react";
import { Component, useState, type ReactNode } from "react";
import { ImportScreen } from "./screens/ImportScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { RunScreen } from "./screens/RunScreen";
import { packageParamFromUrl } from "./package";
import { clearSession, loadSession, saveSession } from "./session";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";
import { MONO } from "./ui/mono";

type Screen = "import" | "review" | "run";
const STEPS: { id: Screen; label: string }[] = [
    { id: "import", label: "Import" },
    { id: "review", label: "Review" },
    { id: "run", label: "Execute" },
];

/**
 * Defense-in-depth: a malformed package that clears decode validation but still
 * throws during render must not blank the host app. Keyed by screen so it resets
 * on navigation. The header lives outside it, so the user can always recover.
 */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-dead/40 bg-exit-dead/10 p-3 text-sm text-exit-dead">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                        <p className="font-medium">Couldn’t render this package</p>
                        <p className="mt-0.5 text-xs text-exit-dead/80">
                            {this.state.error.message}. Load a different package to continue.
                        </p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

/**
 * A package in the URL always wins over a stored one, so share links stay
 * predictable. Used as a lazy `useState` initialiser so it runs once.
 */
function restoreSession() {
    if (packageParamFromUrl(new URL(window.location.href))) return null;
    const s = loadSession();
    if (!s) return null;
    // A run screen without an endpoint cannot execute; fall back to review.
    if (s.screen === "run" && !s.esploraUrl) return { ...s, screen: "review" as const };
    return s;
}

/**
 * The whole exit flow: import → review → execute, plus session persistence, the
 * stepper, the error boundary and the forget/resume affordances.
 *
 * Deliberately does NOT render page chrome. Each host supplies its own via the
 * `header` and `footer` slots — a standalone tool wants a masthead, a route
 * inside a larger app already has navigation and a page heading around it.
 */
export function ExitFlow({
    header,
    footer,
    esploraOverride,
}: {
    header?: ReactNode;
    footer?: ReactNode;
    /** Endpoint that wins over the SDK per-network default. The host reads this
     * from its own bundler's env; the package never touches `import.meta.env`. */
    esploraOverride?: string;
}) {
    const [restored] = useState(restoreSession);
    const [screen, setScreen] = useState<Screen>(restored?.screen ?? "import");
    const [pkg, setPkg] = useState<ExitPackage | null>(restored?.pkg ?? null);
    const [feeKeyHex, setFeeKeyHex] = useState<string | null>(restored?.feeKeyHex ?? null);
    const [esplora, setEsplora] = useState<string>(restored?.esploraUrl ?? "");
    const [confirmingReset, setConfirmingReset] = useState(false);
    const [resumed, setResumed] = useState(!!restored);
    const [saveFailed, setSaveFailed] = useState(false);

    const reset = () => {
        clearSession();
        setPkg(null);
        setFeeKeyHex(null);
        setEsplora("");
        setScreen("import");
        setConfirmingReset(false);
        setResumed(false);
        setSaveFailed(false);
    };

    /**
     * There is no "start over" for an exit. This executor is keyless, so it
     * cannot produce a different package for the same VTXOs — only the wallet
     * that owns them can. A funded package has already broadcast its splitter at
     * prepare time, before this code ever saw it. So the only real actions are
     * to resume, or to forget the exit locally.
     *
     * Forgetting is destructive to *resumability* whenever the package can't be
     * trivially reloaded: after execution has begun, or when it was restored
     * from storage rather than a file the user demonstrably still holds.
     */
    const forgetIsDestructive = screen === "run" || resumed;

    const onForget = () => {
        if (forgetIsDestructive && !confirmingReset) {
            setConfirmingReset(true);
            return;
        }
        reset();
    };

    const currentIndex = STEPS.findIndex((s) => s.id === screen);

    return (
        <>
            <div className="mb-8 flex items-center justify-between gap-4">
                {header ?? <span />}
                {pkg &&
                    (confirmingReset ? (
                        <div className="flex items-center gap-2">
                            <span className="hidden max-w-xs text-right text-[11px] text-exit-ink-faint sm:inline">
                                Only forgets it on this device. Transactions already broadcast stay
                                onchain, and you’ll need the package file to resume.
                            </span>
                            <Button size="sm" variant="danger" onClick={reset}>
                                Forget it
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmingReset(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={onForget}>
                            {screen === "run" ? (
                                <>
                                    <Trash2 className="size-3.5" /> Forget this exit
                                </>
                            ) : (
                                <>
                                    <FileUp className="size-3.5" /> Load a different package
                                </>
                            )}
                        </Button>
                    ))}
            </div>

            <nav className="mb-8 flex items-center gap-2">
                {STEPS.map((s, i) => (
                    <div key={s.id} className="flex flex-1 items-center gap-2">
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                                    MONO,
                                    i < currentIndex && "bg-exit-ok/20 text-exit-ok",
                                    i === currentIndex && "bg-exit-signal text-exit-signal-ink",
                                    i > currentIndex &&
                                        "border border-exit-line text-exit-ink-faint",
                                )}
                            >
                                {i + 1}
                            </span>
                            <span
                                className={cn(
                                    "text-xs",
                                    i === currentIndex ? "text-exit-ink" : "text-exit-ink-faint",
                                )}
                            >
                                {s.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <span
                                className={cn(
                                    "h-px flex-1",
                                    i < currentIndex ? "bg-exit-ok/40" : "bg-exit-line",
                                )}
                            />
                        )}
                    </div>
                ))}
            </nav>

            <main className="flex-1">
                {resumed && (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-exit)] border border-exit-line bg-exit-panel-2/60 px-3 py-2 text-xs text-exit-ink-dim">
                        <span>Resumed a saved exit from this browser.</span>
                        {/* Only "Dismiss" here — the header owns the single
                            destructive action, so there is one way to forget an
                            exit rather than two. */}
                        <Button size="sm" variant="ghost" onClick={() => setResumed(false)}>
                            Dismiss
                        </Button>
                    </div>
                )}
                {saveFailed && (
                    <div className="mb-4 rounded-[var(--radius-exit)] border border-exit-wait/40 bg-exit-wait/10 px-3 py-2 text-xs text-exit-wait">
                        This exit is too large to save on this device — keep your package file, you
                        will need it to resume.
                    </div>
                )}
                <ScreenErrorBoundary key={screen}>
                    {screen === "import" && (
                        <ImportScreen
                            onImport={(loaded) => {
                                setPkg(loaded.pkg);
                                setFeeKeyHex(loaded.feeKeyHex ?? null);
                                setScreen("review");
                                setSaveFailed(
                                    !saveSession({
                                        pkg: loaded.pkg,
                                        feeKeyHex: loaded.feeKeyHex,
                                        screen: "review",
                                    }),
                                );
                            }}
                        />
                    )}
                    {screen === "review" && pkg && (
                        <ReviewScreen
                            pkg={pkg}
                            esploraOverride={esploraOverride}
                            onContinue={(url) => {
                                setEsplora(url);
                                setScreen("run");
                                setSaveFailed(
                                    !saveSession({
                                        pkg,
                                        esploraUrl: url,
                                        feeKeyHex: feeKeyHex ?? undefined,
                                        screen: "run",
                                    }),
                                );
                            }}
                        />
                    )}
                    {screen === "run" && pkg && esplora && (
                        <RunScreen
                            pkg={pkg}
                            esploraUrl={esplora}
                            embeddedFeeKeyHex={feeKeyHex}
                            onComplete={clearSession}
                        />
                    )}
                </ScreenErrorBoundary>
            </main>

            {footer}
        </>
    );
}
