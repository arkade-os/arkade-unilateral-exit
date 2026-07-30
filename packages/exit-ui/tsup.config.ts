import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    // The SDK is a peer: bundling it would put a second copy in the consumer's
    // tree, duplicating its crypto weight and breaking instanceof across the
    // boundary.
    external: ["@arkade-os/sdk"],
});
