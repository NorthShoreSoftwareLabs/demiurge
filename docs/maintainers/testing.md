# Testing

`pnpm verify` is the local and CI quality gate. It runs linting, the core build,
generated route typechecking, per-file coverage, every example build, production
example probes, browser conformance, and packed-consumer verification.

Install Chromium once before running the complete gate:

```sh
pnpm install
pnpm exec playwright install chromium
pnpm verify
```

## Test layers

Each behavior should be tested at the layer where it can fail.

| Layer | Location or command | Protects |
| --- | --- | --- |
| Unit and component | `packages/core/tests` | Framework logic, public behavior, and DOM integration |
| Type and consumer | `pnpm typecheck` | Generated routes, examples, and TypeScript contracts |
| Example build | `pnpm build:examples` | File discovery, bundling, SSR/static output, and exports |
| Production integration | `tests/integration` | Running example servers and cross-request behavior |
| Browser conformance | `browser-tests` | Hydration, navigation, CSP, cookies, Fetch Metadata, and fallbacks |
| Packed consumer | `tests/package` | Tarball contents, declarations, entry points, and clean installation |

Unit tests live beside the package rather than in the repository-level `tests`
directory. The repository-level tests deliberately exercise built examples or a
packed artifact and therefore cross package boundaries.

## Commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm build:examples
pnpm test:examples
pnpm test:browser
pnpm test:pack
pnpm verify
```

The core coverage configuration enforces an 80 percent minimum per source file,
not only in aggregate. Failed CI runs upload the HTML coverage report. Playwright
retains traces and screenshots according to `playwright.config.ts`.

## Adding coverage

- Put pure framework and request-pipeline tests under the matching directory in
  `packages/core/tests`.
- Add or extend an example when public developer behavior changes.
- Add a production integration probe when behavior depends on a real server,
  process boundary, cache lifetime, or built artifact.
- Add a browser test when only a browser can prove the behavior.
- Extend packed-consumer verification when package metadata, exports,
  declarations, peer dependencies, or supported Node versions change.

A test is complete when it fails for the regression it is meant to prevent and
passes through `pnpm verify` from a clean checkout.
