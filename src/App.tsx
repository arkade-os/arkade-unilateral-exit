import { DoorOpen } from "lucide-react";
import { ExitFlow } from "@arkade-os/exit-ui";

/**
 * This app is a masthead and a footer around `ExitFlow`. Everything else —
 * import, review, execute, session persistence, the stepper — lives in
 * @arkade-os/exit-ui and is shared with the explorer's copy.
 */
export function App() {
    return (
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-8">
            <ExitFlow
                // Vite's build-time override. Read here, not in the package,
                // which must not assume a bundler.
                esploraOverride={import.meta.env.VITE_ESPLORA_URL}
                header={
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
                }
                footer={
                    <footer className="mt-10 border-t border-line pt-4 text-[11px] text-ink-faint">
                        Runs entirely in your browser. Package secrets never leave this page except
                        as transactions broadcast to your chosen Esplora endpoint.
                    </footer>
                }
            />
        </div>
    );
}
