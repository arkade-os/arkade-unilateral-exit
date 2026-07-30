import type { ExitPackage } from "@arkade-os/sdk";
import { FEE_KEY_RE, packageParamFromUrl, parsePackageObject } from "./package";

/**
 * Where a resumable exit is kept.
 *
 * The stored value includes the graph-mode `feeKeyHex` — a live private key, in
 * plaintext, for as long as the exit lasts. Its scope is deliberately tiny: it
 * only ever holds the CPFP fee sats the user deposits, never VTXO value, so the
 * worst case is losing that small remainder. It is still readable by anything
 * with script access to this origin, so treat an exported bundle and this key
 * as sensitive.
 */
const STORAGE_KEY = "arkade-exit:session";
const SCREENS = ["review", "run"] as const;

export type SessionScreen = (typeof SCREENS)[number];

/**
 * Everything needed to resume an exit. Deliberately does NOT include progress:
 * `UnilateralExit.Executor` re-derives every step's state from the chain on each
 * run, so a cached cursor could only ever be a way to be wrong.
 */
export interface ExitSession {
    pkg: ExitPackage;
    esploraUrl?: string;
    /** Fee key from an `arkadeExitBundle`. It is used directly and never written
     * to `arkade-exit:fee-key`, so it must ride along or a restored graph-mode
     * exit would mint a different, unfunded key. */
    feeKeyHex?: string;
    screen: SessionScreen;
}

/** The slice of the Storage API this module needs. Injectable so tests need no
 * jsdom, and so a shared package need not depend on browser globals. */
export interface SessionStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export function defaultStore(): SessionStore | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        // Access itself throws when storage is blocked (Safari private mode).
        return null;
    }
}

/**
 * Persist the session. Never throws: an exit package carries full transaction
 * hex for every step and localStorage is ~5 MB of UTF-16, so a large exit can
 * exceed quota — and a failed save must not interrupt a running exit.
 *
 * On failure any previously stored session is dropped. Leaving it would be
 * worse than storing nothing: the next load would restore a *different* exit
 * than the one on screen, so the user would resume the wrong package. Storing
 * nothing merely costs them the resume.
 *
 * @returns false when the session could not be stored.
 */
export function saveSession(s: ExitSession, store: SessionStore | null = defaultStore()): boolean {
    if (!store) return false;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(s));
        return true;
    } catch {
        try {
            store.removeItem(STORAGE_KEY);
        } catch {
            // Storage is entirely unavailable. Nothing further to do — the
            // caller already learns the save failed from the return value.
        }
        return false;
    }
}

/**
 * Restore a session, or null if there isn't a usable one.
 *
 * Stored state is untrusted input: localStorage is writable by anything sharing
 * the origin and the package flows straight into the render path, so the package
 * is re-validated through the same gate as import. Anything suspect is treated
 * as "no session" rather than surfaced as an error — the user didn't ask for it.
 */
export function loadSession(store: SessionStore | null = defaultStore()): ExitSession | null {
    if (!store) return null;
    let raw: string | null;
    try {
        raw = store.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;

    try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const screen = obj.screen;
        if (typeof screen !== "string" || !SCREENS.includes(screen as SessionScreen)) return null;

        // Same validation as the import path — never a second implementation.
        // `parsePackageObject` takes the already-parsed value, so a package with
        // hundreds of full-hex steps isn't re-serialized and re-parsed here.
        const { pkg } = parsePackageObject(obj.pkg);

        const esploraUrl = typeof obj.esploraUrl === "string" ? obj.esploraUrl : undefined;
        const feeKeyHex =
            typeof obj.feeKeyHex === "string" && FEE_KEY_RE.test(obj.feeKeyHex)
                ? obj.feeKeyHex
                : undefined;

        return { pkg, esploraUrl, feeKeyHex, screen: screen as SessionScreen };
    } catch {
        return null;
    }
}

/**
 * Whether forgetting the exit on screen would destroy something the user cannot
 * get back, and therefore needs confirming.
 *
 * A pure function, and tested, because the rule is subtle and has been wrong
 * twice. In particular `restoredFromStorage` is *provenance*, not banner
 * visibility: conflating the two means dismissing the resumed banner silently
 * disarms the gate, and the next "load a different package" wipes the only saved
 * copy without asking.
 *
 * - in flight — broadcasts are already out and live progress would be lost
 * - restored from storage — the user may no longer hold the package file
 * - finished — nothing left to lose, so confirming is pure friction
 */
export function forgetNeedsConfirmation(state: {
    complete: boolean;
    isRunning: boolean;
    restoredFromStorage: boolean;
}): boolean {
    if (state.complete) return false;
    return state.isRunning || state.restoredFromStorage;
}

/**
 * What to restore on mount, or null when there is nothing usable.
 *
 * A package in the URL always wins over a stored one, so share links stay
 * predictable. A stored `run` screen without an endpoint cannot execute, so it
 * degrades to `review` rather than rendering a screen that would sit inert.
 *
 * `url` and `store` are parameters rather than globals so both branches are
 * testable — they are exactly where the original "resume doesn't work" bug
 * could creep back in unnoticed.
 */
export function restoreSession(
    url: URL,
    store: SessionStore | null = defaultStore(),
): ExitSession | null {
    if (packageParamFromUrl(url)) return null;
    const s = loadSession(store);
    if (!s) return null;
    if (s.screen === "run" && !s.esploraUrl) return { ...s, screen: "review" as const };
    return s;
}

export function clearSession(store: SessionStore | null = defaultStore()): void {
    if (!store) return;
    try {
        store.removeItem(STORAGE_KEY);
    } catch {
        /* nothing useful to do */
    }
}
