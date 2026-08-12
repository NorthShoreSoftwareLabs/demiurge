# Pipeline Quality Gates

Tracking: #1

## Goal

Make framework quality enforceable instead of aspirational. The project should
fail fast when lint, type safety, tests, coverage, or examples regress.

## Features To Implement

- `pnpm lint` using ESLint.
- `pnpm coverage` using Vitest coverage.
- 80% per-file coverage threshold for statements, branches, functions, and
  lines.
- `pnpm verify` as the local and CI entry point.
- CI workflow running `pnpm verify`.
- Coverage should count framework source under `src/`, not examples or tests.

## Examples Required

- `examples/basic-blog` must continue to build under `pnpm build`.
- `examples/ssr-page` must continue to build under `pnpm build`.
- `examples/streaming-page` must continue to build under `pnpm build`.
- `examples/runtime-server-data` must build and its production probe must verify
  cache scopes and TTL expiry under `pnpm verify`.
- `examples/app-owned-fallbacks` must build and its production probe must verify
  fallback selection, response negotiation, and error redaction under
  `pnpm verify`.
- Future fixture examples should be added to the pipeline as they are created.
- Generated route manifests are written to a dot-directory that TypeScript's
  wildcard include skips, so each one must be named explicitly in `tsconfig.json`
  or the typed-route gate silently does nothing.

## Tests Required

- The existing Vitest suite must pass under coverage.
- Type assertions for generated actual URL strings must continue to run under
  `pnpm typecheck`.

## Open Decisions

None open.

## Decisions Made

- The publishable package is MIT licensed and ships its own package-focused
  README and identical license text. `pnpm test:pack` treats metadata, legal
  files, declarations, every export, and a clean external app build as one
  artifact contract rather than trusting workspace examples alone.
- Node 22.13 is the minimum supported runtime for `0.1.0`; CI pins that exact
  floor for the package contract while the complete verification job runs on
  Node 24. Node declarations stay on the matching Node 22 major so newer APIs
  cannot enter the public implementation unnoticed.
- Releases originate only from a clean, signed version tag. The release
  workflow re-runs verification, rejects open p1 milestone issues and unrelated
  npm ownership, publishes through npm trusted publishing with provenance, and
  creates the GitHub release after npm succeeds. Stable versions use `latest`;
  prereleases use `next`.
- The existing unscoped npm name belongs to an unrelated project. Registry
  ownership or a coordinated scoped rename is a first-publish operation; it
  does not change the local `0.1.0` artifact and external-consumer contract.

- CI uploads the coverage HTML report only when the run fails (#14). The text
  reporter already prints the per-file table into the log and per-file
  thresholds name the file that dipped, so the report adds line-level detail
  and nothing else. Paying for that on every push is how a pipeline gets slow
  by accretion. Paying for it on the run that fails costs nothing the rest of
  the time.
- Playwright lands before the streaming work, scoped to Chromium alone (#13,
  setup in #87). `jsdom` already covers hydration and fallbacks; what it cannot
  do is enforce CSP, run Trusted Types, consume a stream progressively, or
  provide a real `IntersectionObserver`. The first of those needs no streaming
  to test, so the harness is not waiting on #52. Its first assertion is the
  claim the framework rests on and nothing currently verifies: the strict preset
  renders a working page with no `unsafe-inline`.
