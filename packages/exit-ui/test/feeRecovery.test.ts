import { describe, expect, it } from "vitest";
import { quoteFeeSweep, SWEEP_DUST_SATS } from "../src/feeRecovery";

const P2TR = "bc1p5glxh60daldfxemk9vpmnhukha6778pr5rnq7kkyq7yxz7s33yks2jrvcs";
const P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

const quote = (over: Partial<Parameters<typeof quoteFeeSweep>[0]> = {}) =>
    quoteFeeSweep({
        balanceSats: 2556,
        inputCount: 2,
        destination: P2TR,
        network: "bitcoin",
        feeRate: 1,
        ...over,
    });

describe("quoteFeeSweep", () => {
    /**
     * The real remainder from a finished mainnet graph exit: two confirmed
     * coins, 2556 sats, nothing left to pay for. The point of the panel is that
     * this is recoverable rather than abandoned.
     */
    it("prices the real leftover wallet", () => {
        const q = quote();
        expect(q.balanceSats).toBe(2556);
        expect(q.feeSats).toBeGreaterThan(0);
        expect(q.amountSats).toBe(2556 - q.feeSats);
        expect(q.viable).toBe(true);
    });

    it("charges more for more inputs", () => {
        expect(quote({ inputCount: 3 }).feeSats).toBeGreaterThan(quote({ inputCount: 1 }).feeSats);
    });

    it("scales with the fee rate", () => {
        expect(quote({ feeRate: 10 }).feeSats).toBe(quote({ feeRate: 1 }).feeSats * 10);
    });

    // A P2TR output is larger than a P2WPKH one. Quoting the wrong shape leaves
    // the user a few sats short or over, and `send` rejects an amount it cannot
    // fund — so the estimate is taken against the address actually entered.
    it("sizes the output against the destination's own type", () => {
        expect(quote({ destination: P2TR }).feeSats).toBeGreaterThan(
            quote({ destination: P2WPKH }).feeSats,
        );
    });

    // The panel quotes live while the user is still typing, so a half-entered
    // address must not throw — and must not under-quote either.
    it("falls back to the larger output size for an undecodable address", () => {
        const partial = quote({ destination: "bc1qnot-a-real-add" });
        expect(partial.feeSats).toBeGreaterThanOrEqual(quote({ destination: P2WPKH }).feeSats);
        expect(Number.isFinite(partial.feeSats)).toBe(true);
    });

    // Sweeping dust hands the entire balance to miners and lands an output
    // nothing can spend. Better to say so than to offer the button.
    it("is not viable when what survives is dust", () => {
        const q = quote({ balanceSats: SWEEP_DUST_SATS + 10 });
        expect(q.amountSats).toBeLessThan(SWEEP_DUST_SATS);
        expect(q.viable).toBe(false);
    });

    it("is not viable when the balance cannot cover its own fee", () => {
        const q = quote({ balanceSats: 50 });
        expect(q.amountSats).toBe(0);
        expect(q.viable).toBe(false);
    });

    it("is not viable, and free, with nothing to sweep", () => {
        expect(quote({ balanceSats: 0, inputCount: 0 })).toMatchObject({
            feeSats: 0,
            amountSats: 0,
            viable: false,
        });
    });

    it("honours a caller-supplied dust floor", () => {
        expect(quote({ balanceSats: 1200, dustSats: 5000 }).viable).toBe(false);
        expect(quote({ balanceSats: 1200, dustSats: 100 }).viable).toBe(true);
    });
});
