/**
 * Onchain data reads as data, not prose.
 *
 * Expressed as Tailwind utilities rather than a custom class, so the theming
 * contract stays a set of CSS custom properties — a consuming app has to define
 * `--color-exit-*` and `--radius-exit`, and nothing else. `font-mono` resolves
 * through each app's own `--font-mono`.
 */
export const MONO = "font-mono tabular-nums tracking-[-0.01em]";
