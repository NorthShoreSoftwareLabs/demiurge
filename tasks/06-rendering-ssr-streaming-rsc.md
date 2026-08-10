# Rendering SSR Streaming And RSC

Tracking: #8

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

## Open Decisions

- How partial prerendering should combine a static shell with runtime holes
  without weakening CSP or requiring a specific deployment adapter.

## Decisions Made

- Initial RSC data ships as a sequence of inert `<template data-demiurge-flight>`
  elements, one per chunk, read by a `MutationObserver` that feeds a
  `ReadableStream` (#55). This extends the route-data mechanism at
  `document/render.ts:128` instead of adding a second one. A template is not
  code, so `script-src` has nothing to permit and the execution path a
  nonce-backed data script would open does not exist. Safety comes from
  escaping, as it did for the inline version, plus one invariant: the reader
  only ever reads `textContent` and never clones the fragment into the document,
  because a `<script>` inside cloned template content executes on insertion.
  This does not remove #24. React's boundary-completion scripts move nodes, so
  they are code and still need the nonce.
- `render: { mode: "streaming" }` selects `renderToPipeableStream(...)` (#52).
  Metadata and static document contributions resolve before `onShellReady`;
  Suspense boundaries may complete later.
- The per-response document nonce is passed to React as well as every
  framework-managed script. This covers React's inline completion scripts under
  strict CSP.
- Pre-shell errors use the normal 500 page-error path. Post-shell errors are
  reported but cannot change the committed status. Cancelling the body aborts
  rendering without application-error reporting.
