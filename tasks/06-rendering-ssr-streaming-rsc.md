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
- One document renderer, `renderDocument(...)` in `src/document/render.ts`,
  now serves both the HTTP request handler and the Vite integration. It takes
  an optional `body` and emits the hydration marker plus bootstrap script only
  when one is present, so the same code path produces both server-rendered
  documents and static shells.
- `renderPageDocument(...)` returns the rendered document as a string, and
  `renderPageResponse(...)` is a thin `Response` wrapper over it.
- `examples/ssr-page` exercises a server-only `data` loader, metadata cascading
  from layout to leaf, a `path`-based dynamic route, and client navigation
  after hydration.

## Open Decisions

- Whether initial RSC data is delivered through a nonce-backed script,
  non-executable JSON script, or separate fetch.
- Whether the production build should prerender documents. The build emits a
  bodiless shell because `generateBundle` has no request to render against, so
  built output is client-rendered while dev and the HTTP handler are not. A
  static adapter with `paths`-driven prerendering is the way to close that gap.
