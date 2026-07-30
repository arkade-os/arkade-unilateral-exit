import { FileUp, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
    Button,
    Card,
    CardContent,
    decodePackageBlob,
    packageParamFromUrl,
    readFileText,
    type LoadedPackage,
} from "../index";

export function ImportScreen({ onImport }: { onImport: (loaded: LoadedPackage) => void }) {
    const [error, setError] = useState<string | null>(null);
    const [text, setText] = useState("");
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    async function tryDecode(blob: string) {
        setError(null);
        try {
            onImport(await decodePackageBlob(blob));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }

    // Auto-load from ?pkg= / #pkg= on first mount.
    useEffect(() => {
        const param = packageParamFromUrl(new URL(window.location.href));
        if (param) void tryDecode(param);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex flex-col gap-5">
            <Card
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={async (e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) await tryDecode(await readFileText(file));
                }}
                className={dragging ? "border-exit-signal bg-exit-panel-2/80" : undefined}
            >
                <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full border border-exit-line bg-exit-panel-2">
                        <FileUp className="size-5 text-exit-ink-dim" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-exit-ink">Drop your exit package</p>
                        <p className="mt-1 text-xs text-exit-ink-dim">
                            a{" "}
                            <span className="font-mono tabular-nums tracking-[-0.01em]">.json</span>{" "}
                            file, or paste it below
                        </p>
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json,text/plain"
                        className="hidden"
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) await tryDecode(await readFileText(file));
                        }}
                    />
                    <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                        Choose file
                    </Button>
                </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-exit-ink-dim">
                    Or paste package / share link
                </label>
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    spellCheck={false}
                    placeholder='{"version":1,…}  or  base64url share blob'
                    className="w-full resize-y rounded-[var(--radius-exit)] border border-exit-line bg-exit-panel/60 p-3 font-mono text-xs text-exit-ink placeholder:text-exit-ink-faint focus:border-exit-ink-faint focus:outline-none"
                />
                <Button
                    className="self-start"
                    disabled={!text.trim()}
                    onClick={() => tryDecode(text)}
                >
                    Load package
                </Button>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-[var(--radius-exit)] border border-exit-dead/40 bg-exit-dead/10 p-3 text-sm text-exit-dead">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                        <p className="font-medium">Could not read package</p>
                        <p className="mt-0.5 text-xs text-exit-dead/80">{error}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
