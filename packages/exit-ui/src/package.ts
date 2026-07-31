import { deserializeExitPackage, type ExitPackage } from "@arkade-os/sdk";

/**
 * Decode a URL-safe base64 string to bytes. Accepts padded or unpadded, and
 * both the URL alphabet (`-_`) and standard (`+/`).
 */
function base64urlToBytes(s: string): Uint8Array {
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    // Copy into a fresh ArrayBuffer-backed view so the type is concrete
    // (`Uint8Array<ArrayBuffer>`), satisfying BufferSource under TS 5.9.
    void writer.write(new Uint8Array(bytes));
    void writer.close();
    return await new Response(ds.readable).text();
}

/**
 * A decoded package plus any transport-level extras layered on top of the SDK
 * format. `feeKeyHex` is present only for a graph-mode *bundle* exported with
 * its ephemeral fee key embedded (see {@link encodeExitBundle}) — such a bundle
 * is self-executable and needs no re-funding.
 */
export interface LoadedPackage {
    pkg: ExitPackage;
    feeKeyHex?: string;
}

/** Marker on the self-executable envelope (distinguishes it from a bare package). */
const BUNDLE_MARKER = "arkadeExitBundle";

/** Shape of an ephemeral fee key: 32 bytes, lowercase hex. Exported so the
 * session store validates against the same constant rather than its own copy —
 * two independent regexes would drift silently. */
export const FEE_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Render-safety validation, on top of the SDK's own.
 *
 * The screens dereference these fields unconditionally
 * (`pkg.totals.txCount`, `truncateMiddle(v.outpoint)`), so a hostile or
 * truncated package that clears `deserializeExitPackage` would crash the render
 * — a blank page, reachable from a bare `?pkg=` link. This makes the failure
 * surface through the import error path instead.
 *
 * Measured against `@arkade-os/sdk` 0.4.53, the split is:
 *
 * - **`vtxos[]` — load-bearing.** The SDK accepts a numeric `outpoint`, a
 *   string `value`, a vtxo with no `outpoint` at all, and an empty `vtxos`
 *   array. Only these checks stand between such a package and the render.
 * - **`totals` — defensive depth.** The SDK already rejects a missing `totals`
 *   and a non-numeric value in any of the four fields, so in practice it fails
 *   first and this branch never fires. Kept deliberately: the guarantee belongs
 *   to a dependency we do not control, and the cost of keeping it is one
 *   comparison per import.
 *
 * Both throw messages contain "totals", so a test asserting `/totals/i` passes
 * whichever layer rejects — do not read such a test as proof this branch ran.
 */
function assertRenderable(pkg: ExitPackage): void {
    const totals = pkg.totals as unknown as Record<string, unknown> | null | undefined;
    const numericFields = ["txCount", "totalFeeSats", "fundingRequiredSats", "recoveredSats"];
    if (!totals || numericFields.some((k) => typeof totals[k] !== "number")) {
        throw new Error("invalid exit package: missing or malformed totals");
    }
    for (const v of pkg.vtxos as unknown as Array<Record<string, unknown>>) {
        if (typeof v.outpoint !== "string") {
            throw new Error("invalid exit package: every vtxo needs a string outpoint");
        }
        if (v.value !== undefined && typeof v.value !== "number") {
            throw new Error("invalid exit package: vtxo value must be a number");
        }
    }
}

/**
 * Interpret an already-parsed value as either the self-executable bundle
 * (envelope with an embedded fee key) or a bare SDK exit package. Either way the
 * package itself is validated by the SDK — the single source of truth.
 *
 * Exposed separately from {@link parsePackageJson} so a caller already holding a
 * parsed object — the session store, on every page load — can skip the
 * stringify-then-parse round trip at the boundary. A package carries full
 * transaction hex for every step, so that round trip materializes every hex
 * string twice more than necessary.
 *
 * Note this does NOT avoid serialization altogether: `deserializeExitPackage` is
 * the SDK's validator and takes a string, so one `JSON.stringify` still happens
 * below. The saving is one stringify plus one parse, not all of them.
 */
export function parsePackageObject(obj: unknown): LoadedPackage {
    if (obj && typeof obj === "object" && BUNDLE_MARKER in obj) {
        const bundle = obj as { pkg?: unknown; feeKeyHex?: unknown };
        const pkg = deserializeExitPackage(JSON.stringify(bundle.pkg));
        assertRenderable(pkg);
        const feeKeyHex =
            typeof bundle.feeKeyHex === "string" && FEE_KEY_RE.test(bundle.feeKeyHex)
                ? bundle.feeKeyHex
                : undefined;
        return { pkg, feeKeyHex };
    }
    const pkg = deserializeExitPackage(JSON.stringify(obj));
    assertRenderable(pkg);
    return { pkg };
}

/**
 * Parse raw text as an exit package (bare or bundled). Validation (version,
 * step shapes) is delegated to the SDK's `deserializeExitPackage`, the single
 * source of truth for the format — the UI never re-implements it.
 */
export function parsePackageJson(text: string): LoadedPackage {
    let obj: unknown;
    try {
        obj = JSON.parse(text);
    } catch {
        throw new Error("not valid JSON");
    }
    return parsePackageObject(obj);
}

/**
 * Serialize a package for export. With a `feeKeyHex` it produces the
 * self-executable bundle — the graph-mode equivalent of a fully-signed funded
 * package: the recipient can run it standalone against the already-funded fee
 * address, with no key of their own and no re-funding. Without a key it emits
 * the bare SDK package (unchanged transport).
 *
 * The embedded key is an ephemeral fee-only key; anyone with the bundle can
 * spend its small fee remainder, so treat the exported file as sensitive.
 */
export function encodeExitBundle(pkg: ExitPackage, feeKeyHex?: string): string {
    const body =
        feeKeyHex && FEE_KEY_RE.test(feeKeyHex)
            ? { [BUNDLE_MARKER]: 1 as const, pkg, feeKeyHex }
            : pkg;
    return JSON.stringify(body, null, 2);
}

/**
 * Decode a package from a transport blob that may be:
 *   1. raw JSON (bare package or `{arkadeExitBundle}` envelope),
 *   2. base64url(JSON), or
 *   3. base64url(gzip(JSON)) — the compact form used in share links.
 * Tries the cheapest interpretation first and falls through.
 */
export async function decodePackageBlob(blob: string): Promise<LoadedPackage> {
    const trimmed = blob.trim();

    // 1. raw JSON
    if (trimmed.startsWith("{")) {
        return parsePackageJson(trimmed);
    }

    const bytes = base64urlToBytes(trimmed);

    // 2. gzip magic bytes 0x1f 0x8b → decompress
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        return parsePackageJson(await gunzip(bytes));
    }

    // 3. base64url(JSON), no compression
    const text = new TextDecoder().decode(bytes);
    return parsePackageJson(text);
}

/**
 * Extract a package payload from the current location, if present. Prefers
 * the URL fragment (`#pkg=…`) — it never reaches server logs, mirrors, or
 * proxies — and falls back to the query string (`?pkg=…`).
 */
export function packageParamFromUrl(url: URL): string | null {
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    return hash.get("pkg") ?? url.searchParams.get("pkg");
}

export async function readFileText(file: File): Promise<string> {
    return await file.text();
}
