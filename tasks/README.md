# Tasks

This folder holds the specs. Each file describes what an area is for, what it
still needs, and which decisions are unresolved.

**Status lives in GitHub issues, not here.** A file that carries its own status
line goes stale the moment work lands somewhere else, which is how every task
file in this folder came to say "in progress" at once.

## Where things live

| Question | Answer |
| --- | --- |
| What is this area for, and what does it still need? | `tasks/*.md` |
| What is in progress, and how much is done? | GitHub issues and milestones |
| What already shipped? | `CHANGELOG.md` |
| Why is it designed this way? | `docs/` |

`docs/07-feature-inventory.md` is reconciled against source and `CHANGELOG.md`
at every milestone close. It is a release snapshot, not an independent status
tracker, and must distinguish callable primitives from automatically wired
runtime behavior.

## Epics

Each spec has a tracking issue whose checklist is the completion count. The
count is derived from checked boxes, never hand-typed.

| Spec | Epic |
| --- | --- |
| `01-pipeline-quality-gates.md` | #1 |
| `02-security-policy-and-csp.md` | #4 |
| `03-route-policies-and-middleware.md` | #5 |
| `04-metadata-scripts-document-output.md` | #6 |
| `05-data-cache-and-static-generation.md` | #7 |
| `06-rendering-ssr-streaming-rsc.md` | #8 |
| `07-realtime-protocols.md` | #9 |
| `08-platform-features.md` | #10 |
| `09-adapters-and-deployment.md` | #11 |
| `10-framework-owned-document-runtime.md` | #2 (closed) |
| `11-error-and-not-found.md` | #3 |

## Milestones

- **0.1.0 Production ready Node.** Everything needed to ship an app on the Node
  adapter without a blank page or an undocumented behavior.
- **0.2.0 Streaming and prerender.** Streaming SSR, static prerendering, and the
  CSP modes that depend on both.
- **0.3.0 Adapters and platform.** A second runtime to pressure-test the
  capability contract, shared cache adapters, and platform wiring.
- **Backlog.** Real work with no scheduled release.

## Labels

`area:*` for the subsystem, `type:*` for the kind of work, `p1` through `p3` for
priority. Two labels carry meaning worth stating: `needs-decision` marks work
blocked on a judgment call rather than on effort, and `blocked` marks work
waiting on another issue to land.

## Pipeline contract

Every change keeps this green:

```sh
pnpm verify
```

`verify` enforces ESLint across source, tests, scripts, and examples; generated
route types plus `tsc --noEmit`; Vitest coverage at 80% minimum; the example
builds; and the packed artifact contract, including a clean external consumer
typecheck and production build.

## Done definition

An issue closes when all of these are true:

- Framework API and runtime behavior exist.
- There is a test at the layer where the feature can actually fail.
- An example under `examples/` covers it when developer-facing behavior changed.
- Docs moved with the code.
- `pnpm verify` is green.

Filing a follow-up issue is a legitimate way to keep scope honest. Closing
something that only half works is not.
