/**
 * App-local formatters. `cn` and `truncateMiddle` used to live here too; they
 * now come from `@arkade-os/exit-ui`, since the package's own components need
 * them. These two stay until C2b moves the screens, which is what uses them.
 */

/** Format satoshis with locale grouping. */
export function formatSats(sats: number): string {
    return `${sats.toLocaleString("en-US")} sats`;
}

export function btc(sats: number): string {
    return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`;
}
