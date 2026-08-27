import { getNetwork, OnchainWallet, TxWeightEstimator, type NetworkName } from "@arkade-os/sdk";

/** Below this an output is unspendable, so sweeping it would burn it as fee. */
export const SWEEP_DUST_SATS = 546;

export interface FeeSweepQuote {
    /** Confirmed sats the fee wallet holds. */
    balanceSats: number;
    /** Estimated fee for a one-output sweep of every confirmed coin. */
    feeSats: number;
    /** What would land at the destination. Never negative. */
    amountSats: number;
    /**
     * Whether the sweep is worth broadcasting. False when the balance cannot
     * cover its own fee, or when what survives is dust — a sweep in either case
     * hands the whole balance to miners for nothing.
     */
    viable: boolean;
}

/**
 * Price a sweep of the graph-mode fee wallet.
 *
 * Sized with the SDK's own {@link TxWeightEstimator} rather than local
 * constants, so this cannot drift from what `OnchainWallet.send` charges — an
 * under-estimate here would make `send` reject the amount as unfundable.
 *
 * The output is sized against the real destination: a P2TR address costs more
 * than a P2WPKH one, and quoting the wrong one leaves the user a few sats out.
 * An address the network cannot decode falls back to a P2TR-sized output, the
 * larger of the two, so the estimate stays conservative rather than throwing
 * while someone is still typing.
 */
export function quoteFeeSweep(params: {
    balanceSats: number;
    inputCount: number;
    destination: string;
    network: NetworkName;
    feeRate: number;
    dustSats?: number;
}): FeeSweepQuote {
    const { balanceSats, inputCount, destination, network } = params;
    const dust = params.dustSats ?? SWEEP_DUST_SATS;
    // `OnchainWallet.send` raises anything below its floor before selecting
    // coins, so quoting the raw rate would under-state the fee and over-state
    // what survives — and `send` would then reject the amount it cannot fund.
    const feeRate = Math.max(params.feeRate, OnchainWallet.MIN_FEE_RATE);

    const est = TxWeightEstimator.create();
    for (let i = 0; i < inputCount; i++) est.addKeySpendInput(true);
    try {
        est.addOutputAddress(destination, getNetwork(network));
    } catch {
        est.addP2TROutput();
    }

    const feeSats = inputCount === 0 ? 0 : Math.ceil(Number(est.vsize().value) * feeRate);
    const amountSats = Math.max(0, balanceSats - feeSats);
    return {
        balanceSats,
        feeSats,
        amountSats,
        viable: inputCount > 0 && amountSats >= dust,
    };
}
