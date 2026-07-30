import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    // tsup already externalises everything in `dependencies` and
    // `peerDependencies` — verified against the built output: react,
    // react/jsx-runtime, lucide-react and the radix packages are all left as
    // imports, with no bundled-React markers present. Listing the peers
    // explicitly is belt-and-braces: a second copy of React in a consumer's tree
    // breaks hooks outright, and a second copy of the SDK duplicates its crypto
    // weight and breaks `instanceof` across the boundary. Too consequential to
    // leave resting on a default.
    external: ["@arkade-os/sdk", "react", "react-dom", "react/jsx-runtime", "lucide-react"],
});
