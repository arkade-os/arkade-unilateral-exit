import type { ExitPackage } from "@arkade-os/sdk";
import { DoorOpen, FileUp, ShieldAlert, Trash2 } from "lucide-react";
import { Component, useCallback, useState, type ReactNode } from "react";
import { ImportScreen } from "@/components/ImportScreen";
import { ReviewScreen } from "@/components/ReviewScreen";
import { RunScreen } from "@/components/RunScreen";
import { Button } from "@/components/ui/button";
import { clearSession, forgetNeedsConfirmation, restoreSession, saveSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Screen = "import" | "review" | "run";
const STEPS: { id: Screen; label: string }[] = [
    { id: "import", label: "Import" },
    { id: "review", label: "Review" },
    { id: "run", label: "Execute" },
];

/**
 * Defense-in-depth: a malformed package that clears decode validation but still
 * throws during render must not blank the whole app. Keyed by screen so it
 * resets on navigation. The header — which owns the only way to load a
 * different package — lives outside it, so the user can always recover.
 */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="flex items-start gap-2 rounded-[var(--radius)] border border-dead/40 bg-dead/10 p-3 text-sm text-dead">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                        <p className="font-medium">Couldn’t render this package</p>
                        <p className="mt-0.5 text-xs text-dead/80">
                            {this.state.error.message}. Use “Load a different package” in the header
                            to try another file.
                        </p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export function App() {
    // Lazy initialiser so the URL and storage are read once, on mount.
    const [restored] = useState(() => restoreSession(new URL(window.location.href)));
    const [screen, setScreen] = useState<Screen>(restored?.screen ?? "import");
    const [pkg, setPkg] = useState<ExitPackage | null>(restored?.pkg ?? null);
    const [feeKeyHex, setFeeKeyHex] = useState<string | null>(restored?.feeKeyHex ?? null);
    const [esplora, setEsplora] = useState<string>(restored?.esploraUrl ?? "");
    const [confirmingReset, setConfirmingReset] = useState(false);
    // Provenance, NOT banner visibility. This feeds the confirmation gate: a
    // package that came from storage may be one the user no longer has a file
    // for. Dismissing the banner must not change this — see `showResumeBanner`.
    const [restoredFromStorage, setRestoredFromStorage] = useState(!!restored);
    const [showResumeBanner, setShowResumeBanner] = useState(!!restored);
    // Starts false even on a restore: a session in storage is itself proof that
    // the last save succeeded.
    const [saveFailed, setSaveFailed] = useState(false);
    // Whether the exit currently on screen is actually recoverable from this
    // browser. Restored sessions are by definition saved; a fresh import is
    // saved only if `saveSession` succeeded.
    const [sessionSaved, setSessionSaved] = useState(!!restored);
    const [complete, setComplete] = useState(false);

    const reset = () => {
        clearSession();
        setPkg(null);
        setFeeKeyHex(null);
        setEsplora("");
        setScreen("import");
        setConfirmingReset(false);
        setRestoredFromStorage(false);
        setShowResumeBanner(false);
        setSaveFailed(false);
        setSessionSaved(false);
        setComplete(false);
    };

    /** A clean finish drops the stored session — there is nothing left to
     * resume — and with it the banner and the confirmation gate.
     *
     * Memoised: it is in the dependency list of the effect that calls it, so an
     * unstable identity would re-fire that effect on the re-render this very
     * handler causes. Harmless today because every operation here is idempotent,
     * but only by luck. */
    const onComplete = useCallback(() => {
        clearSession();
        setRestoredFromStorage(false);
        setShowResumeBanner(false);
        setSessionSaved(false);
        setComplete(true);
    }, []);

    /**
     * There is no "start over" for an exit. This app is keyless, so it cannot
     * produce a different package for the same VTXOs — only the wallet that
     * owns them can. A funded package has already broadcast its splitter at
     * prepare time, before this app ever saw it. So the only real actions are
     * to resume, or to forget the exit locally.
     *
     * The rule for when forgetting needs confirming lives in `session.ts` and is
     * unit-tested — it is subtle enough to have been wrong twice.
     */
    const forgetIsDestructive = forgetNeedsConfirmation({
        complete,
        isRunning: screen === "run",
        restoredFromStorage,
    });

    const onForget = () => {
        if (forgetIsDestructive && !confirmingReset) {
            setConfirmingReset(true);
            return;
        }
        reset();
    };

    const currentIndex = STEPS.findIndex((s) => s.id === screen);

    return (
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-8">
            <header className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-[var(--radius)] border border-signal/30 bg-signal/10">
                        <DoorOpen className="size-4 text-signal" />
                    </div>
                    <div>
                        <h1 className="text-sm font-semibold tracking-tight text-ink">
                            Arkade Unilateral Exit
                        </h1>
                        <p className="text-[11px] text-ink-dim">
                            keyless executor · your funds, onchain, no operator
                        </p>
                    </div>
                </div>
                {pkg &&
                    (confirmingReset ? (
                        <div className="flex items-center gap-2">
                            <span className="hidden max-w-xs text-right text-[11px] text-ink-faint sm:inline">
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
            </header>

            <nav className="mb-8 flex items-center gap-2">
                {STEPS.map((s, i) => (
                    <div key={s.id} className="flex flex-1 items-center gap-2">
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular",
                                    i < currentIndex && "bg-ok/20 text-ok",
                                    i === currentIndex && "bg-signal text-signal-ink",
                                    i > currentIndex && "border border-line text-ink-faint",
                                )}
                            >
                                {i + 1}
                            </span>
                            <span
                                className={cn(
                                    "text-xs",
                                    i === currentIndex ? "text-ink" : "text-ink-faint",
                                )}
                            >
                                {s.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <span
                                className={cn(
                                    "h-px flex-1",
                                    i < currentIndex ? "bg-ok/40" : "bg-line",
                                )}
                            />
                        )}
                    </div>
                ))}
            </nav>

            <main className="flex-1">
                {showResumeBanner && (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius)] border border-line bg-panel-2/60 px-3 py-2 text-xs text-ink-dim">
                        <span>Resumed a saved exit from this browser.</span>
                        {/* Only "Dismiss" here — the header owns the single
                            destructive action, so there is one way to forget an
                            exit rather than two. Dismissing hides the banner and
                            nothing else: the confirmation gate keys off
                            `restoredFromStorage`, which this does not touch. */}
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowResumeBanner(false)}
                        >
                            Dismiss
                        </Button>
                    </div>
                )}
                {saveFailed && (
                    <div className="mb-4 rounded-[var(--radius)] border border-wait/40 bg-wait/10 px-3 py-2 text-xs text-wait">
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
                                const ok = saveSession({
                                    pkg: loaded.pkg,
                                    feeKeyHex: loaded.feeKeyHex,
                                    screen: "review",
                                });
                                setSaveFailed(!ok);
                                setSessionSaved(ok);
                            }}
                        />
                    )}
                    {screen === "review" && pkg && (
                        <ReviewScreen
                            pkg={pkg}
                            onContinue={(url) => {
                                setEsplora(url);
                                setScreen("run");
                                const ok = saveSession({
                                    pkg,
                                    esploraUrl: url,
                                    feeKeyHex: feeKeyHex ?? undefined,
                                    screen: "run",
                                });
                                setSaveFailed(!ok);
                                setSessionSaved(ok);
                            }}
                        />
                    )}
                    {screen === "run" && pkg && esplora && (
                        <RunScreen
                            pkg={pkg}
                            esploraUrl={esplora}
                            embeddedFeeKeyHex={feeKeyHex}
                            sessionSaved={sessionSaved}
                            onComplete={onComplete}
                        />
                    )}
                </ScreenErrorBoundary>
            </main>

            <footer className="mt-10 border-t border-line pt-4 text-[11px] text-ink-faint">
                Runs entirely in your browser. Package secrets never leave this page except as
                transactions broadcast to your chosen Esplora endpoint.
            </footer>
        </div>
    );
}
