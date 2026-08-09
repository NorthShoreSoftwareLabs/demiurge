# Rendering SSR Streaming And RSC

Status: in progress

## Goal

Demiurge should make React rendering modes explicit per route while keeping CSP,
data loading, caching, and typing coherent.

## Features To Implement

- SSR page responses.
- Streaming SSR with nonce propagation.
- React Server Components with Flight served as data where possible.
- Static prerendering.
- Partial prerendering with build-time CSP compatibility checks.
- Hydration modes: none, page, islands.
- Retry behavior for data and actions.
- Safe bootstrap data serialization.

## Examples Required

- `examples/ssr-page`
- `examples/streaming-page`
- `examples/rsc-page`
- `examples/partial-prerender`

## Tests Required

- Server tests for SSR and streaming responses.
- Browser tests for hydration and navigation.
- Security tests for nonce-backed scripts/styles.
- Type tests for route render-mode options.

## Implemented Slices

- `renderPageResponse(...)` renders the page/layout tree, resolved metadata,
  resource hints, and static scripts into the framework-owned document.
- Route `data` is serialized into a non-executable `application/json` bootstrap
  script, escaped against `<`, `>`, `&`, and line separators.
- `hydrateFileRouter(...)` reads that payload, reuses it instead of re-running
  route `data`, and seeds the browser router with the resolved match so the
  first client paint does not flash a loading fallback.
- The server marks its rendered root with `data-demiurge-hydrate`, and the
  client hydrates only when that marker is present. A static shell without
  server markup is client-rendered instead, because hydrating an empty root
  produces a React hydration mismatch.

## Open Decisions

- Whether initial RSC data is delivered through a nonce-backed script,
  non-executable JSON script, or separate fetch.
- Whether the Vite dev server and build should render the SSR document instead
  of the current static shell. Today `createDocumentHtml(...)` in the Vite
  plugin and `renderDocument(...)` in `src/server/ssr.ts` are separate renderers
  that have already drifted, and only the second one can produce markup to
  hydrate.
