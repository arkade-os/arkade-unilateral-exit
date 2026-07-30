/** Format satoshis with locale grouping. */
export function formatSats(sats: number): string {
    return `${sats.toLocaleString("en-US")} sats`;
}

export function btc(sats: number): string {
    return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`;
}
