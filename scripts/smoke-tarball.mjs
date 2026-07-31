/**
 * Verifies a packed `@arkade-os/exit-ui` tarball from the position an external
 * consumer actually occupies.
 *
 * This exists because a workspace consumer cannot catch a whole class of
 * packaging bug. Inside the workspace, the package's own screens import each
 * other by relative path and the app here only uses `ExitFlow` — so a helper can
 * be written, used, tested and built while never appearing in the public
 * surface. Typecheck, tests, build and lint all stay green and the package is
 * still broken for everyone outside it. That is exactly how three exports went
 * missing, found only by packing and installing elsewhere.
 *
 * Run it from a scratch project that has installed the tarball:
 *   node ./smoke.mjs
 *
 * Node resolves imports relative to this file, so copying it into the consumer
 * directory is what makes it resolve the *installed* package rather than the
 * workspace source.
 */
import { readFileSync } from "node:fs";

const failures = [];
const check = (label, ok, detail) => {
    if (ok) {
        console.log(`  ok    ${label}`);
    } else {
        console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
        failures.push(label);
    }
};

const mod = await import("@arkade-os/exit-ui");

// A representative slice of the surface rather than the full list: the complete
// contract is asserted by packages/exit-ui/test/publicApi.test.ts, which fails
// loudly on drift in either direction. These are the entry points a consumer
// cannot build the feature without, one per module that has gone missing or
// could plausibly be dropped from index.ts.
console.log("public surface resolves from the tarball");
for (const name of [
    "ExitFlow",
    "ImportScreen",
    "ReviewScreen",
    "RunScreen",
    "decodePackageBlob",
    "parsePackageObject",
    "restoreSession",
    "forgetNeedsConfirmation",
    "esploraUrlFor",
    "loadOrCreateFeeKey",
    "phaseFor",
]) {
    check(name, name in mod && mod[name] !== undefined, "not exported");
}

// Guards the runtime, not just the type surface: a broken build can still
// export the right names while the code behind them throws on first call.
console.log("logic runs");
try {
    const network = mod.esploraUrlFor("regtest");
    check("esploraUrlFor(regtest)", typeof network === "string" && network.length > 0, network);
    // Both sides of a deliberate asymmetry: a step skipped *with* a reason is a
    // branch that failed and must not read as confirmed, while a bare skip is a
    // branch that simply wasn't needed. Getting this backwards once showed a
    // failed exit branch as a green tick.
    check(
        "phaseFor(skipped, reason) is skipped",
        mod.phaseFor("skipped", "parent failed") === "skipped",
    );
    check("phaseFor(skipped) is confirmed", mod.phaseFor("skipped") === "confirmed");
} catch (err) {
    check("logic runs without throwing", false, err.message);
}

// Validation must survive the build. If a bundler dropped these branches the
// package would accept malformed input instead of refusing it.
//
// The assertion is on the *shape* of the failure, not an exact string: a domain
// error naming the exit package proves input was validated and rejected, where a
// bare TypeError would mean validation was bypassed and something downstream
// crashed while using the garbage. Which layer rejects it — the SDK's version and
// field checks, or this package's render-safety checks on top — is covered by the
// unit tests and deliberately not pinned here.
console.log("validation intact");
try {
    mod.parsePackageObject({ nonsense: true });
    check("rejects a malformed package", false, "it was accepted");
} catch (err) {
    check(
        "rejects a malformed package",
        err instanceof Error && /exit package/i.test(err.message),
        `unexpected failure shape: ${err}`,
    );
}

const dist = readFileSync("node_modules/@arkade-os/exit-ui/dist/index.js", "utf8");

// Two copies of React in one page breaks hooks at runtime with an error that
// points nowhere near the cause, so this is worth asserting rather than trusting
// tsup's default externalisation to keep behaving.
console.log("peers stay external");
for (const peer of ['from "react"', 'from "react/jsx-runtime"', 'from "lucide-react"']) {
    check(peer, dist.includes(peer), "bundled instead of imported");
}

// Tailwind scans source text for class names. If the build ever mangled them
// into computed strings, consumers would install a package that renders unstyled
// and the failure would look like a problem with their own CSS.
console.log("tailwind class names survive into dist");
for (const cls of ["bg-exit-signal", "text-exit-ink-faint", "border-exit-dead"]) {
    check(cls, dist.includes(cls), "class name missing");
}

console.log("");
if (failures.length) {
    console.error(
        `tarball smoke test FAILED: ${failures.length} check(s) — ${failures.join(", ")}`,
    );
    process.exit(1);
}
console.log("tarball smoke test passed");
