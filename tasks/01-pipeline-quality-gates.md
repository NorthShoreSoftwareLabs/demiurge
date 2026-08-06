# Pipeline Quality Gates

Status: in progress

## Goal

Make framework quality enforceable instead of aspirational. The project should
fail fast when lint, type safety, tests, coverage, or examples regress.

## Features To Implement

- `npm run lint` using ESLint.
- `npm run coverage` using Vitest coverage.
- 80% coverage threshold for statements, branches, functions, and lines.
- `npm run verify` as the local and CI entry point.
- CI workflow once the repo remote/workflow target is decided.
- Coverage should count framework source under `src/`, not examples or tests.

## Examples Required

- `examples/basic-blog` must continue to build under `npm run build`.
- Future fixture examples should be added to the pipeline as they are created.

## Tests Required

- The existing Vitest suite must pass under coverage.
- Type assertions for generated actual URL strings must continue to run under
  `npm run typecheck`.

## Open Decisions

- Whether to add Playwright before or after SSR/metadata work.
- Whether CI should publish coverage HTML as an artifact.
