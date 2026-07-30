import type { ExitPackage } from "@arkade-os/sdk";
import { parsePackageJson } from "@/lib/package";

const STORAGE_KEY = "arkade-exit:session";
const FEE_KEY_RE = /^[0-9a-f]{64}$/;
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

function defaultStore(): SessionStore | null {
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
 * @returns false when the session could not be stored.
 */
export function saveSession(s: ExitSession, store: SessionStore | null = defaultStore()): boolean {
    if (!store) return false;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(s));
        return true;
    } catch {
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
        const { pkg } = parsePackageJson(JSON.stringify(obj.pkg));

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

export function clearSession(store: SessionStore | null = defaultStore()): void {
    if (!store) return;
    try {
        store.removeItem(STORAGE_KEY);
    } catch {
        /* nothing useful to do */
    }
}
