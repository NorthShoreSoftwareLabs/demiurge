# Pipeline Quality Gates

Tracking: #1

## Goal

Make framework quality enforceable instead of aspirational. The project should
fail fast when lint, type safety, tests, coverage, or examples regress.

## Features To Implement

- `npm run lint` using ESLint.
- `npm run coverage` using Vitest coverage.
- 80% per-file coverage threshold for statements, branches, functions, and
  lines.
- `npm run verify` as the local and CI entry point.
- CI workflow running `npm run verify`.
- Coverage should count framework source under `src/`, not examples or tests.

## Examples Required

- `examples/basic-blog` must continue to build under `npm run build`.
- `examples/ssr-page` must continue to build under `npm run build`.
- Future fixture examples should be added to the pipeline as they are created.
- Generated route manifests are written to a dot-directory that TypeScript's
  wildcard include skips, so each one must be named explicitly in `tsconfig.json`
  or the typed-route gate silently does nothing.

## Tests Required

- The existing Vitest suite must pass under coverage.
- Type assertions for generated actual URL strings must continue to run under
  `npm run typecheck`.

## Open Decisions

- Whether CI should publish coverage HTML as an artifact.

## Decisions Made

- Playwright lands before the streaming work, scoped to Chromium alone (#13,
  setup in #87). `jsdom` already covers hydration and fallbacks; what it cannot
  do is enforce CSP, run Trusted Types, consume a stream progressively, or
  provide a real `IntersectionObserver`. The first of those needs no streaming
  to test, so the harness is not waiting on #52. Its first assertion is the
  claim the framework rests on and nothing currently verifies: the strict preset
  renders a working page with no `unsafe-inline`.
