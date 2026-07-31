import { describe, expect, it } from "vitest";
import {
    decodePackageBlob,
    encodeExitBundle,
    packageParamFromUrl,
    parsePackageObject,
} from "../src/package";
import type { ExitPackage } from "@arkade-os/sdk";

const pkg: ExitPackage = {
    version: 1,
    mode: "funded",
    network: "regtest",
    createdAt: 1720000000,
    feeRate: 2,
    sweepAddress: "bcrt1pexample",
    totals: { txCount: 1, totalFeeSats: 100, fundingRequiredSats: 200, recoveredSats: 900 },
    vtxos: [{ outpoint: "aa".repeat(32) + ":0", value: 1000, sweepFee: 100 }],
    steps: [{ kind: "broadcast", txid: "cc".repeat(32), hex: "02000000" }],
};

const json = JSON.stringify(pkg);

function bytesToBase64url(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function gzipToBase64url(text: string): Promise<string> {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    void writer.write(new TextEncoder().encode(text));
    void writer.close();
    const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    return bytesToBase64url(bytes);
}

describe("decodePackageBlob", () => {
    it("decodes raw JSON", async () => {
        expect(await decodePackageBlob(json)).toEqual({ pkg });
    });

    it("decodes base64url(JSON)", async () => {
        const b64 = bytesToBase64url(new TextEncoder().encode(json));
        expect(await decodePackageBlob(b64)).toEqual({ pkg });
    });

    it("decodes base64url(gzip(JSON)) — the share-link form", async () => {
        const blob = await gzipToBase64url(json);
        expect(await decodePackageBlob(blob)).toEqual({ pkg });
    });

    it("rejects an unknown version via the SDK validator", async () => {
        const bad = JSON.stringify({ ...pkg, version: 2 });
        await expect(decodePackageBlob(bad)).rejects.toThrow(/version/i);
    });
});

describe("decodePackageBlob rejects render-crashing packages", () => {
    // Each of these would crash the render if it reached a screen, so decode has
    // to refuse it. They do not all fail at the same layer, though, and the
    // assertions here deliberately do not care which one rejects — only that the
    // package never gets through:
    //
    //   totals  -> the SDK rejects these first; assertRenderable is depth behind it
    //   vtxos   -> the SDK accepts them, so assertRenderable is the only guard
    //
    // Both layers' totals messages contain "totals", so `/totals/i` matching here
    // is not evidence that assertRenderable ran. See its JSDoc.
    it("rejects a package with no totals", async () => {
        const noTotals: Record<string, unknown> = { ...pkg };
        delete noTotals.totals;
        await expect(decodePackageBlob(JSON.stringify(noTotals))).rejects.toThrow(/totals/i);
    });

    it("rejects a non-numeric totals field", async () => {
        const bad = { ...pkg, totals: { ...pkg.totals, txCount: "lots" } };
        await expect(decodePackageBlob(JSON.stringify(bad))).rejects.toThrow(/totals/i);
    });

    it("rejects a vtxo whose outpoint is not a string", async () => {
        const bad = { ...pkg, vtxos: [{ outpoint: 123, value: 1000 }] };
        await expect(decodePackageBlob(JSON.stringify(bad))).rejects.toThrow(/outpoint/i);
    });

    it("rejects a vtxo whose value is not a number", async () => {
        const bad = { ...pkg, vtxos: [{ outpoint: "aa:0", value: "lots" }] };
        await expect(decodePackageBlob(JSON.stringify(bad))).rejects.toThrow(/value/i);
    });
});

describe("encodeExitBundle / decodePackageBlob round-trip", () => {
    const feeKeyHex = "ab".repeat(32);

    it("embeds the fee key and recovers it on decode", async () => {
        const blob = encodeExitBundle(pkg, feeKeyHex);
        expect(await decodePackageBlob(blob)).toEqual({ pkg, feeKeyHex });
    });

    it("emits a bare package (no envelope) when no fee key is given", async () => {
        const blob = encodeExitBundle(pkg);
        expect(JSON.parse(blob)).toEqual(pkg);
        expect(await decodePackageBlob(blob)).toEqual({ pkg });
    });

    it("drops a malformed fee key rather than embedding it", async () => {
        const blob = encodeExitBundle(pkg, "not-a-key");
        expect(await decodePackageBlob(blob)).toEqual({ pkg });
    });
});

/**
 * The session store calls `parsePackageObject` directly on every page load —
 * that path is the whole reason the function is exported separately. Until now
 * it was only ever reached through `decodePackageBlob → parsePackageJson`, so
 * the entry point a restored session actually uses had no test of its own, and
 * a regression reachable only from storage would have gone unnoticed.
 */
describe("parsePackageObject (the session-restore entry point)", () => {
    const feeKeyHex = "ab".repeat(32);

    it("accepts an already-parsed bare package", () => {
        expect(parsePackageObject(structuredClone(pkg))).toEqual({ pkg });
    });

    it("accepts an already-parsed bundle envelope and recovers the fee key", () => {
        const envelope = { arkadeExitBundle: 1, pkg: structuredClone(pkg), feeKeyHex };
        expect(parsePackageObject(envelope)).toEqual({ pkg, feeKeyHex });
    });

    // A stored envelope is untrusted input: localStorage is writable by anything
    // running on the origin. A malformed key must be dropped, not handed to the
    // fee wallet, where it would fail somewhere far less legible.
    it("drops a malformed fee key from a stored envelope", () => {
        const envelope = { arkadeExitBundle: 1, pkg: structuredClone(pkg), feeKeyHex: "nope" };
        expect(parsePackageObject(envelope)).toEqual({ pkg });
    });

    it("drops a non-string fee key from a stored envelope", () => {
        const envelope = { arkadeExitBundle: 1, pkg: structuredClone(pkg), feeKeyHex: 42 };
        expect(parsePackageObject(envelope)).toEqual({ pkg });
    });

    // assertRenderable has to fire from this entry point too, not just from the
    // decode path — otherwise a package that would crash the render could reach
    // the screens via a restored session while being rejected on fresh import.
    it("rejects malformed totals from the object entry point", () => {
        const bad = { ...structuredClone(pkg), totals: { ...pkg.totals, txCount: "lots" } };
        expect(() => parsePackageObject(bad)).toThrow(/totals/i);
    });

    it("rejects a vtxo with a non-string outpoint from the object entry point", () => {
        const bad = { ...structuredClone(pkg), vtxos: [{ outpoint: 123, value: 1000 }] };
        expect(() => parsePackageObject(bad)).toThrow(/outpoint/i);
    });

    it("rejects an unknown version from the object entry point", () => {
        const bad = { ...structuredClone(pkg), version: 2 };
        expect(() => parsePackageObject(bad)).toThrow(/version/i);
    });
});

describe("packageParamFromUrl", () => {
    it("prefers the #fragment over the query string", () => {
        const url = new URL("https://x.io/?pkg=QUERY#pkg=FRAGMENT");
        expect(packageParamFromUrl(url)).toBe("FRAGMENT");
    });

    it("falls back to the query string", () => {
        const url = new URL("https://x.io/?pkg=QUERY");
        expect(packageParamFromUrl(url)).toBe("QUERY");
    });

    it("returns null when absent", () => {
        expect(packageParamFromUrl(new URL("https://x.io/"))).toBeNull();
    });
});
