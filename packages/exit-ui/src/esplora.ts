import { ESPLORA_URL, type NetworkName } from "@arkade-os/sdk";

/**
 * Resolve the onchain Esplora REST endpoint for a network, using the SDK's own
 * per-network constant — the same one the SDK's providers use, so there is no
 * second map to drift.
 *
 * The endpoint must be CORS-permissive (the executor calls it straight from the
 * browser) and expose `/txs/package` for 1P1C relay. Always editable in the UI.
 *
 * @param override optional caller-supplied endpoint that wins over the default.
 *   Deliberately a parameter rather than read from `import.meta.env` in here:
 *   that is Vite-specific and would tie this package to one bundler. The
 *   consuming app supplies its own build-time value.
 */
export function esploraUrlFor(network: string | undefined, override?: string): string {
    if (override) return override;
    return ESPLORA_URL[(network ?? "bitcoin") as NetworkName] ?? ESPLORA_URL.bitcoin;
}
