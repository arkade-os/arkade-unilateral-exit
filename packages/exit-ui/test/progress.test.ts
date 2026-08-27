import type { ExitPackage } from "@arkade-os/sdk";
import { describe, expect, it } from "vitest";
import {
    CHILD_DUST_AMOUNT,
    anchorTxidFor,
    ctaLabelFor,
    isSweepMature,
    outstandingFundingSats,
    probeExitProgress,
    stepState,
    summarizeExitProgress,
    type ChainReader,
    type ExitProgress,
} from "../src/progress";

const DELAY = { type: "seconds", value: 605184 } as const;

/**
 * Modelled on a real mainnet graph-mode package: four VTXOs, each unrolled by a
 * `bump` step and then swept, 1112 sats of CPFP funding across the four bumps.
 * A sweep's `dependsOnTxid` is its own VTXO's txid, which is also the bump's
 * `parentTxid` — the overlap `probeExitProgress` deduplicates.
 */
function pkg(overrides: Partial<ExitPackage> = {}): ExitPackage {
    const vtxos = [
        { outpoint: "aa:0", value: 187592, delay: DELAY },
        { outpoint: "bb:0", value: 1000, delay: DELAY },
        { outpoint: "cc:0", value: 1000, delay: DELAY },
        { outpoint: "dd:0", value: 2100, delay: DELAY },
    ];
    return {
        version: 1,
        mode: "graph",
        network: "bitcoin",
        createdAt: 1785418534,
        feeRate: 1,
        sweepAddress: "13HaCAB4jf7FYSZexJxoczyDDnutzZigjS",
        totals: {
            txCount: 12,
            totalFeeSats: 1704,
            fundingRequiredSats: 1112,
            recoveredSats: 191100,
        },
        vtxos,
        steps: [
            ...["aa", "bb", "cc", "dd"].map((t) => ({
                kind: "bump" as const,
                parentTxid: t,
                parentHex: "00",
                forVtxos: [`${t}:0`],
            })),
            ...["aa", "bb", "cc", "dd"].map((t) => ({
                kind: "sweep" as const,
                vtxo: `${t}:0`,
                txid: `sweep-${t}`,
                hex: "00",
                dependsOnTxid: t,
                delay: DELAY,
            })),
        ],
        ...overrides,
    } as ExitPackage;
}

/** Nothing known about anything — the state a fresh import starts from. */
const EMPTY: ExitProgress = { txs: {}, tip: null, degraded: false };

function progress(
    txs: ExitProgress["txs"],
    tip: ExitProgress["tip"] = null,
    degraded = false,
): ExitProgress {
    return { txs, tip, degraded };
}

describe("anchorTxidFor", () => {
    // The executor keys `package`/`bump` on parentTxid and `broadcast`/`sweep`
    // on txid. Disagreeing with it here would mean asking the chain about a
    // different transaction than the one the executor waits on.
    it("matches the executor's choice of txid per step kind", () => {
        const p = pkg();
        expect(anchorTxidFor(p.steps[0])).toBe("aa");
        expect(anchorTxidFor(p.steps[4])).toBe("sweep-aa");
    });
});

describe("stepState", () => {
    it("defaults to pending when the chain said nothing", () => {
        expect(stepState(pkg().steps[0], EMPTY)).toBe("pending");
    });

    it("reads confirmed and mempool through the step's anchor", () => {
        const p = progress({ aa: { state: "confirmed" }, bb: { state: "mempool" } });
        expect(stepState(pkg().steps[0], p)).toBe("confirmed");
        expect(stepState(pkg().steps[1], p)).toBe("mempool");
    });
});

describe("outstandingFundingSats", () => {
    it("asks for the whole amount when nothing has been done", () => {
        expect(outstandingFundingSats(pkg(), EMPTY)).toBe(1112 + CHILD_DUST_AMOUNT);
    });

    // The bug this exists to fix: a half-executed exit was gated on the
    // package's original total, so the user was asked to deposit fees for
    // bumps that had already confirmed and been paid for.
    it("charges only for bumps that have not been paid for", () => {
        const p = progress({ aa: { state: "confirmed" }, bb: { state: "confirmed" } });
        // 2 unpaid bumps at 278 each, plus the reserve the last one must leave.
        expect(outstandingFundingSats(pkg(), p)).toBe(556 + CHILD_DUST_AMOUNT);
    });

    /**
     * Regression, from a real mainnet exit that failed on this exact arithmetic.
     *
     * `buildAnchorChild` always writes one change output and rejects change
     * below `CHILD_DUST_AMOUNT` — there is no absorb-into-fee path. Quoting
     * bare fees let the gate open on a 556-sat wallet with two 278-sat bumps
     * left; the first consumed 278 and tried to leave 278 as change, and the
     * executor died with "need change >= 546, got 278". Both branches were
     * marked dead and their sweeps failed with them.
     */
    it("reserves the non-dust change the last bump must leave behind", () => {
        const twoPaid = progress({ aa: { state: "confirmed" }, bb: { state: "confirmed" } });
        const need = outstandingFundingSats(pkg(), twoPaid);
        expect(need).toBe(1102);
        // The balance that actually failed onchain must not clear the gate.
        expect(556 >= need).toBe(false);
        // Walk the SDK's rule forward: every bump leaves legal change.
        let balance = need;
        for (let i = 0; i < 2; i++) {
            balance -= 278;
            expect(balance).toBeGreaterThanOrEqual(CHILD_DUST_AMOUNT);
        }
    });

    // The SDK's own `fundingRequiredSats` is bare fees too, so a package that
    // quotes 1112 for four 278-sat bumps can only ever fund two of them. The
    // gate must ask for more than the package does, not merely echo it.
    it("asks for more than the package quotes on a fresh graph exit", () => {
        expect(outstandingFundingSats(pkg(), EMPTY)).toBe(1112 + CHILD_DUST_AMOUNT);
    });

    // A bump in the mempool has already spent its fee on the CPFP child, so
    // charging for it again would ask for sats that are demonstrably not needed.
    it("treats an in-mempool bump as already paid for", () => {
        const p = progress({ aa: { state: "confirmed" }, bb: { state: "mempool" } });
        expect(outstandingFundingSats(pkg(), p)).toBe(556 + CHILD_DUST_AMOUNT);
    });

    it("owes nothing once every bump is accounted for", () => {
        const p = progress({
            aa: { state: "confirmed" },
            bb: { state: "confirmed" },
            cc: { state: "confirmed" },
            dd: { state: "mempool" },
        });
        expect(outstandingFundingSats(pkg(), p)).toBe(0);
    });

    it("rounds up, so an uneven split never opens the gate underfunded", () => {
        const p = pkg({ totals: { ...pkg().totals, fundingRequiredSats: 1000 } });
        // 3 of 4 bumps unpaid against 1000 sats is 750 exactly; make it uneven.
        const one = progress({ aa: { state: "confirmed" }, bb: { state: "confirmed" } });
        expect(
            outstandingFundingSats(
                pkg({ totals: { ...pkg().totals, fundingRequiredSats: 999 } }),
                one,
            ),
        ).toBe(500 + CHILD_DUST_AMOUNT);
        expect(outstandingFundingSats(p, EMPTY)).toBe(1000 + CHILD_DUST_AMOUNT);
    });

    // `funded` packages pre-paid their fees into the splitter at prepare time;
    // the executor runs them with no wallet, so a funding gate is meaningless.
    it("never asks a funded package for anything", () => {
        expect(outstandingFundingSats(pkg({ mode: "funded" }), EMPTY)).toBe(0);
    });

    it("handles a package with no bump steps", () => {
        expect(outstandingFundingSats(pkg({ steps: [] }), EMPTY)).toBe(0);
    });
});

describe("isSweepMature", () => {
    const sweep = pkg().steps[4];

    it("is false without a chain tip, because maturity is unknowable", () => {
        expect(isSweepMature(sweep, progress({ aa: { state: "confirmed", blockTime: 0 } }))).toBe(
            false,
        );
    });

    it("is false while the dependency is unconfirmed — the clock has not started", () => {
        expect(
            isSweepMature(sweep, progress({ aa: { state: "mempool" } }, { height: 1, time: 1e9 })),
        ).toBe(false);
    });

    it("compares seconds delays against the tip's median time", () => {
        const dep = { aa: { state: "confirmed" as const, blockTime: 1_000_000 } };
        const justShort = progress(dep, { height: 1, time: 1_000_000 + 605_183 });
        const exact = progress(dep, { height: 1, time: 1_000_000 + 605_184 });
        expect(isSweepMature(sweep, justShort)).toBe(false);
        expect(isSweepMature(sweep, exact)).toBe(true);
    });

    it("compares block delays against the tip's height", () => {
        const p = pkg();
        const blockSweep = {
            ...p.steps[4],
            delay: { type: "blocks", value: 144 },
        } as ExitPackage["steps"][number];
        const dep = { aa: { state: "confirmed" as const, blockHeight: 900_000 } };
        expect(isSweepMature(blockSweep, progress(dep, { height: 900_143, time: 0 }))).toBe(false);
        expect(isSweepMature(blockSweep, progress(dep, { height: 900_144, time: 0 }))).toBe(true);
    });

    it("is false for a step that is not a sweep", () => {
        expect(isSweepMature(pkg().steps[0], progress({}, { height: 1, time: 1e9 }))).toBe(false);
    });
});

describe("summarizeExitProgress", () => {
    it("reports a fresh package as not started", () => {
        const s = summarizeExitProgress(pkg(), EMPTY);
        expect(s).toMatchObject({
            confirmed: 0,
            inFlight: 0,
            total: 8,
            isInProgress: false,
            isComplete: false,
            outstandingFundingSats: 1112 + CHILD_DUST_AMOUNT,
            sweepableSats: 0,
        });
    });

    // The real case this was built for: two unrolls confirmed weeks ago, their
    // timelocks long elapsed, so the value behind them is sweepable right now.
    it("counts matured, unswept value as sweepable", () => {
        const p = progress(
            {
                aa: { state: "confirmed", blockTime: 1_000_000 },
                dd: { state: "confirmed", blockTime: 1_000_000 },
            },
            { height: 1, time: 1_000_000 + 605_184 },
        );
        const s = summarizeExitProgress(pkg(), p);
        expect(s.confirmed).toBe(2);
        expect(s.isInProgress).toBe(true);
        expect(s.sweepableSats).toBe(187592 + 2100);
        expect(s.outstandingFundingSats).toBe(556 + CHILD_DUST_AMOUNT);
    });

    // Value already swept is not "recoverable" — it has been recovered.
    it("excludes sweeps that already confirmed", () => {
        const p = progress(
            {
                aa: { state: "confirmed", blockTime: 1_000_000 },
                "sweep-aa": { state: "confirmed" },
            },
            { height: 1, time: 1_000_000 + 605_184 },
        );
        expect(summarizeExitProgress(pkg(), p).sweepableSats).toBe(0);
    });

    it("counts an in-mempool sweep as sweepable, since it has not landed yet", () => {
        const p = progress(
            {
                aa: { state: "confirmed", blockTime: 1_000_000 },
                "sweep-aa": { state: "mempool" },
            },
            { height: 1, time: 1_000_000 + 605_184 },
        );
        const s = summarizeExitProgress(pkg(), p);
        expect(s.inFlight).toBe(1);
        expect(s.sweepableSats).toBe(187592);
    });

    it("reports completion only when every step is confirmed", () => {
        const all = Object.fromEntries(
            pkg().steps.map((st) => [anchorTxidFor(st), { state: "confirmed" as const }]),
        );
        const s = summarizeExitProgress(pkg(), progress(all));
        expect(s.isComplete).toBe(true);
        expect(s.outstandingFundingSats).toBe(0);
    });

    it("carries the degraded flag through so the UI can hedge its counts", () => {
        expect(summarizeExitProgress(pkg(), progress({}, null, true)).degraded).toBe(true);
    });
});

describe("ctaLabelFor", () => {
    const summaryFor = (p: ExitProgress) => summarizeExitProgress(pkg(), p);

    it("asks for funding on a fresh graph package", () => {
        expect(ctaLabelFor(pkg(), summaryFor(EMPTY))).toBe("Set up funding");
    });

    // The wording bug: every bump is paid for, so the funding gate is about to
    // be skipped entirely — promising to "set up funding" would be a lie.
    it("offers to resume when a graph exit owes no more funding", () => {
        const all = Object.fromEntries(
            ["aa", "bb", "cc", "dd"].map((t) => [t, { state: "confirmed" as const }]),
        );
        expect(ctaLabelFor(pkg(), summaryFor(progress(all)))).toBe("Resume exit");
    });

    it("says begin, not resume, when nothing has happened yet", () => {
        expect(ctaLabelFor(pkg({ mode: "funded" }), summaryFor(EMPTY))).toBe("Begin execution");
    });

    it("says resume for a funded package already part-way through", () => {
        const s = summaryFor(progress({ aa: { state: "confirmed" } }));
        expect(ctaLabelFor(pkg({ mode: "funded" }), s)).toBe("Resume exit");
    });

    it("reports a finished exit as nothing left to run", () => {
        const all = Object.fromEntries(
            pkg().steps.map((st) => [anchorTxidFor(st), { state: "confirmed" as const }]),
        );
        expect(ctaLabelFor(pkg(), summaryFor(progress(all)))).toBe("Verify completion");
    });

    // Before the probe answers there is no evidence either way, so a graph
    // package must assume it owes the full amount rather than hide the gate.
    it("falls back to the package's own mode before the probe answers", () => {
        expect(ctaLabelFor(pkg(), null)).toBe("Set up funding");
        expect(ctaLabelFor(pkg({ mode: "funded" }), null)).toBe("Begin execution");
    });
});

describe("probeExitProgress", () => {
    function reader(
        statuses: Record<string, { confirmed: boolean; blockHeight?: number; blockTime?: number }>,
        opts: { tip?: { height: number; time: number }; calls?: string[] } = {},
    ): ChainReader {
        return {
            async getTxStatus(txid) {
                opts.calls?.push(txid);
                const s = statuses[txid];
                if (!s) throw new Error("Not Found");
                return s;
            },
            async getChainTip() {
                if (!opts.tip) throw new Error("unreachable");
                return opts.tip;
            },
        };
    }

    it("classifies confirmed, mempool and missing transactions", async () => {
        const p = await probeExitProgress(
            pkg(),
            reader(
                { aa: { confirmed: true, blockTime: 7 }, bb: { confirmed: false } },
                { tip: { height: 2, time: 9 } },
            ),
        );
        expect(p.txs.aa).toEqual({ state: "confirmed", blockHeight: undefined, blockTime: 7 });
        expect(p.txs.bb).toEqual({ state: "mempool" });
        expect(p.txs.cc).toEqual({ state: "pending" });
        expect(p.tip).toEqual({ height: 2, time: 9 });
    });

    // A sweep's dependency is another step's anchor; querying it twice would
    // double this screen's request count against a rate-limited endpoint.
    it("queries each txid exactly once despite the anchor/dependency overlap", async () => {
        const calls: string[] = [];
        await probeExitProgress(pkg(), reader({}, { tip: { height: 1, time: 1 }, calls }));
        expect(calls.length).toBe(new Set(calls).size);
        // 4 bump parents + 4 sweep txids; the 4 dependencies are the parents.
        expect(calls.length).toBe(8);
    });

    // On a package that has not started, every lookup 404s. Treating that as a
    // degraded probe would put a "some lookups failed" hedge on every fresh
    // import — a warning that always fires is one nobody reads.
    it("is not degraded when lookups 404 but the endpoint is healthy", async () => {
        const p = await probeExitProgress(pkg(), reader({}, { tip: { height: 1, time: 1 } }));
        expect(p.degraded).toBe(false);
        expect(summarizeExitProgress(pkg(), p).outstandingFundingSats).toBe(
            1112 + CHILD_DUST_AMOUNT,
        );
    });

    // An unreadable tip is the one unambiguous signal that the endpoint is not
    // serving us, so 404s can no longer be read as "not broadcast".
    it("is degraded when the chain tip cannot be read", async () => {
        const p = await probeExitProgress(pkg(), reader({ aa: { confirmed: true } }));
        expect(p.tip).toBeNull();
        expect(p.degraded).toBe(true);
        // Still reports what it did learn — a partial result, not a failure.
        expect(p.txs.aa.state).toBe("confirmed");
    });

    it("never rejects, whatever the reader does", async () => {
        const hostile: ChainReader = {
            getTxStatus: () => Promise.reject(new Error("boom")),
            getChainTip: () => Promise.reject(new Error("boom")),
        };
        await expect(probeExitProgress(pkg(), hostile)).resolves.toBeTruthy();
    });
});
