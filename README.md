# Arkade Unilateral Exit

A static, **keyless** web executor for [Arkade](https://arkadeos.com) unilateral exit
packages. Import a pre-signed exit package produced by
[`@arkade-os/sdk`](https://github.com/arkade-os/ts-sdk) and drive every transaction onchain with
nothing but an Esplora-compatible endpoint — no wallet keys, no operator, no Arkade
infrastructure.

Everything runs in your browser. It is a single-page app safe to host anywhere static.

**Live:** <https://arkade-os.github.io/arkade-unilateral-exit/>

## What it does

1. **Import** an exit package — drop a `.json` file, paste it, or open a share link
   (`#pkg=<base64url(gzip(json))>`). The `#`-fragment form keeps the package out of server logs.
2. **Review** the plan — how many VTXOs are exiting and their total value, the amount you recover,
   network fees, funding required, a rough end-to-end time estimate, a per-VTXO breakdown with its
   exit path and CSV timelock, and warnings (expired validity window, embedded condition secrets).
   The Esplora endpoint is under **Advanced settings**.
3. **Execute** — watch each transaction go onchain on a live timeline with confirmation progress
   and CSV maturity countdowns. Safe to close and reopen: the executor is idempotent, the
   blockchain is the only state.

### Two funding modes

| Mode       | How fees are funded                                                        | Executor                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Funded** | A splitter tx broadcast at prepare time pre-funds pre-signed fee children. | Fully keyless — nothing to fund here.                                                                                                                    |
| **Graph**  | Only the tx graph + sweeps are transported.                                | The app generates a **throwaway fee key** in your browser and asks you to _send funds to an address_; it builds and signs the CPFP fee bumps as it goes. |

The graph-mode fee key lives in `localStorage`, only ever holds fee sats (never your exited
funds), and can be regenerated at any time. Losing it forfeits at most the small unspent fee
remainder — the exit is idempotent and re-fundable.

From the funding screen you can also **Export package**: a self-executable bundle
(`{"arkadeExitBundle":1, …}`) carrying the fee key, so another machine can run the same exit
against the already-funded address with no key of its own. It is the graph-mode equivalent of a
fully-signed funded package — and it is sensitive, since anyone holding it can spend the fee
remainder.

## Security notes

- **Treat package files as confidential.** A sweep of a contract path (e.g. a VHTLC claim) embeds
  its condition witness — such as a preimage — in the pre-signed transaction. Anyone with the
  package can read it before broadcast.
- The app performs **no protocol logic of its own** — package parsing, transaction construction,
  and execution all come from `@arkade-os/sdk`. This UI is a thin, auditable shell.
- **The default Esplora endpoint is Arkade-operated.** Defaults come from the SDK's `ESPLORA_URL`
  (e.g. `https://mempool.arkade.sh/api` on mainnet). Nothing forces you to use it: change it under
  Review → Advanced settings, or bake in your own with `VITE_ESPLORA_URL` at build time. Whichever
  you pick sees your transactions (as it must, to broadcast them) and your IP.

## Repository layout

A pnpm workspace. The app lives at the root; shared logic lives in a package beside it.

```
package.json          the app (private) — Vite + React, deploys to Pages
src/                  page chrome only: masthead, footer, mount
packages/exit-ui/     @arkade-os/exit-ui — the exit feature itself
```

`@arkade-os/exit-ui` holds the whole feature: package decoding and the self-executable bundle
envelope, session persistence, ephemeral fee-wallet construction, Esplora endpoint resolution, the
executor step-phase mapping, and the screens that drive them — import, review, funding gate and
execute — behind a single `<ExitFlow />`. `src/` is 60 lines of chrome around it.

It takes `@arkade-os/sdk`, `react`, `react-dom` and `lucide-react` as **peer** dependencies, so a
consumer never ends up with two copies of the SDK or of React (two Reacts breaks hooks at runtime
with an error that points nowhere near the cause).

It renders against a **token contract** rather than a fixed palette. The package styles itself with
`--color-exit-*` and `--radius-exit` custom properties, and each host maps those onto its own theme,
so this app and the explorer share behaviour while keeping their distinct looks. A host must
therefore declare those tokens **and** point Tailwind at the package's built output, which Tailwind
does not scan by default:

```css
@source "../node_modules/@arkade-os/exit-ui/dist";
```

Skip the `@source` line and the app compiles, renders, and comes out unstyled.

The app consumes it as `"@arkade-os/exit-ui": "workspace:*"`, so local development needs nothing
published — but the package must be **built before** the app typechecks or builds, because the app
imports its compiled output. The root `dev`, `build` and `typecheck` scripts do that for you; don't
run `tsc` or `vite` directly without building the package first.

It exists so this app and the copy embedded in
[arkade-explorer](https://github.com/ArkLabsHQ/arkade-explorer) stop drifting apart.

## Build

**Prerequisites:** Node 24 and [corepack](https://nodejs.org/api/corepack.html). pnpm is pinned by
the `packageManager` field, so `corepack enable` gets you the right version automatically — don't
install pnpm globally.

```bash
corepack enable
pnpm install
```

| Script           | What it does                                                              |
| ---------------- | ------------------------------------------------------------------------- |
| `pnpm dev`       | Dev server with HMR.                                                      |
| `pnpm typecheck` | `tsc -b --noEmit`. Strict, with `noUnusedLocals`/`noUnusedParameters`.    |
| `pnpm test`      | Vitest unit tests across the workspace (they live in `packages/exit-ui`). |
| `pnpm lint`      | `prettier --check .`                                                      |
| `pnpm format`    | `prettier --write .`                                                      |
| `pnpm build`     | Typecheck, then a production build into `dist/`.                          |
| `pnpm preview`   | Serve the built `dist/` locally at the same base path Pages uses.         |

CI runs lint, typecheck, test and build on every pull request
(`.github/workflows/ci.yml`).

### Base path

Vite's `base` defaults to `/arkade-unilateral-exit/`, matching the GitHub Pages project site.
`pnpm preview` therefore serves at <http://localhost:4173/arkade-unilateral-exit/>, which is what
you want — it exercises the same asset URLs the deployed site uses.

To build for a different root (a custom domain, or a plain static host), set `BASE_PATH` **on the
build**, not on the preview — it is read at build time and baked into `index.html`:

```bash
BASE_PATH=/ pnpm build && pnpm preview
```

Setting it only on `preview` will serve at `/` while the bundle still points at
`/arkade-unilateral-exit/assets/…`, and every asset 404s.

## Deployment

### GitHub Pages (default)

Every push to `master` triggers `.github/workflows/deploy.yml`, which builds and publishes via
`actions/deploy-pages` to <https://arkade-os.github.io/arkade-unilateral-exit/>.

The repository's Pages source must be set to **GitHub Actions** (Settings → Pages → Build and
deployment → Source), not "Deploy from a branch" — the workflow uploads an artifact rather than
committing to `gh-pages`. The workflow can also be run by hand via `workflow_dispatch`.

### Anywhere else

The build output is plain static files. There is no server runtime and no runtime configuration —
`VITE_ESPLORA_URL` is baked in at build time, and everything else is chosen in the UI.

```bash
BASE_PATH=/ pnpm build   # then serve dist/ with any static file server
```

Because it is a single-page app with no routing, no SPA rewrite rules are needed: `dist/index.html`
is the only entry point.

For a custom domain, build with `BASE_PATH=/` and add a `CNAME` file containing the domain to
`dist/` (or to the repository, if you keep using the Pages workflow).

## Releasing `@arkade-os/exit-ui`

The package is published as a **GitHub Release asset**, not to npm. A release asset is a plain
public tarball URL that installs with no registry configuration and no authentication. GitHub
Packages was considered and rejected: its npm registry requires an authenticated token even to read
a public package, which would mean provisioning and rotating a token in every consumer's build
environment just to run `install`.

Cutting a release is an explicit act — bump the version, tag it, push the tag:

```bash
# 1. bump packages/exit-ui/package.json "version"
# 2. commit that on master
git tag exit-ui-v0.1.0
git push origin exit-ui-v0.1.0
```

`.github/workflows/release-exit-ui.yml` then runs lint, typecheck, tests and the build, checks the
tag matches `package.json` (a mismatch fails the run rather than publishing an asset whose filename
lies about its contents), packs the tarball, smoke-tests it, and creates the release.

Consumers install by URL, with no registry involved:

```json
{
    "dependencies": {
        "@arkade-os/exit-ui": "https://github.com/arkade-os/arkade-unilateral-exit/releases/download/exit-ui-v0.1.0/arkade-os-exit-ui-0.1.0.tgz"
    }
}
```

pnpm records an integrity hash for a bare tarball URL in the lockfile, so consumers still get tamper
detection. Note that release assets are mutable in principle — anyone with write access can delete
and re-upload one — so the lockfile hash is what actually pins the contents. Never re-upload an asset
under an existing tag; cut a new version instead.

### Why the tarball is smoke-tested before it ships

`scripts/smoke-tarball.mjs` installs the packed tarball into a scratch project **outside** the
workspace and imports only the public surface. This catches a class of bug that no in-repo gate can:
inside the workspace the package's own screens import each other by relative path, and `src/App.tsx`
uses only `ExitFlow` — so a helper can be written, used, unit-tested and built while never being
exported from `index.ts`. Typecheck, tests, build and lint all stay green and the package is still
broken for everyone outside it.

That is not hypothetical: three exports were missing exactly this way, and only packing and
installing elsewhere found them. `packages/exit-ui/test/publicApi.test.ts` now pins the full surface
in both directions, and the smoke test independently verifies the built artifact.

## License

MIT
