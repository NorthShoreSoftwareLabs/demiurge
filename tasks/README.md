# Tasks

This folder turns the design docs into executable framework work. A feature is
not done until the framework code, tests, examples, and docs all move together.

## Pipeline Contract

Every task must keep this command green:

```sh
npm run verify
```

`verify` enforces:

- ESLint across source, tests, scripts, docs config, and examples.
- Generated route types plus `tsc --noEmit`.
- Vitest coverage with 80% minimum statements, branches, functions, and lines.
- The example app build.

## Done Definition

Each implementation task needs:

- Framework API and runtime behavior.
- At least one unit, type, fixture, browser, adapter, or security test at the
  layer where the feature can fail.
- Example coverage under `examples/` when a user-facing developer experience is
  affected.
- Documentation updates in `docs/` and, when useful, a task status update here.

## Priority Queue

1. `01-pipeline-quality-gates.md`
2. `02-security-policy-and-csp.md`
3. `03-route-policies-and-middleware.md`
4. `04-metadata-scripts-document-output.md`
5. `05-data-cache-and-static-generation.md`
6. `06-rendering-ssr-streaming-rsc.md`
7. `07-realtime-protocols.md`
8. `08-platform-features.md`
9. `09-adapters-and-deployment.md`
