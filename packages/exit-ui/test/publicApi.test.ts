import { describe, expect, it } from "vitest";
import * as api from "../src/index";

/**
 * The package's own screens import each other through relative paths, and the
 * app in this repo only uses `ExitFlow`. So a helper can exist, be used, be
 * tested, and still never appear in the public surface — typecheck, tests, build
 * and lint all stay green while an external consumer cannot reach it.
 *
 * That is exactly the position the explorer will be in, so the surface is
 * asserted explicitly here rather than left to be discovered downstream.
 */
const PUBLIC_SURFACE = [
    // package decoding + transport
    "parsePackageJson",
    "parsePackageObject",
    "decodePackageBlob",
    "encodeExitBundle",
    "packageParamFromUrl",
    "readFileText",
    "FEE_KEY_RE",
    // session persistence
    "saveSession",
    "loadSession",
    "clearSession",
    "restoreSession",
    "forgetNeedsConfirmation",
    "defaultStore",
    // endpoint + fee wallet
    "esploraUrlFor",
    "loadOrCreateFeeKey",
    "resetFeeKey",
    "makeFeeWallet",
    // executor step mapping
    "phaseFor",
    "KIND_LABEL",
    "PHASE_STYLE",
    // formatting + primitives
    "formatSats",
    "btc",
    "cn",
    "MONO",
    "truncateMiddle",
    "Button",
    "Card",
    "CardHeader",
    "CardTitle",
    "CardContent",
    "Progress",
    "Tooltip",
    "CopyableHash",
    // screens and the flow
    "ImportScreen",
    "ReviewScreen",
    "FundingGate",
    "RunScreen",
    "ExitFlow",
] as const;

describe("public API surface", () => {
    it.each(PUBLIC_SURFACE)("exports %s", (name) => {
        expect(api).toHaveProperty(name);
        expect(api[name as keyof typeof api]).toBeDefined();
    });

    // Catches the reverse drift: something exported by accident, which becomes
    // a support burden the moment a consumer depends on it.
    it("exports nothing beyond the declared surface", () => {
        const actual = Object.keys(api).sort();
        expect(actual).toEqual([...PUBLIC_SURFACE].sort());
    });
});
