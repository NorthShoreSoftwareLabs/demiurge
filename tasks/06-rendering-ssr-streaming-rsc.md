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

- Initial RSC data ships as escaped, nonce-backed inline scripts that append
  Flight chunks to a framework-owned queue (#55). The client consumes chunks
  already buffered in the queue, then replaces its push handler so subsequent
  chunks feed a `ReadableStream`. Binary chunks are base64-encoded. The scripts
  use the same per-response document nonce passed to React's streaming renderer.
- `render: { mode: "streaming" }` selects `renderToPipeableStream(...)` (#52).
  Metadata and static document contributions resolve before `onShellReady`;
  Suspense boundaries may complete later.
- The per-response document nonce is passed to React as well as every
  framework-managed script. This covers React's inline completion scripts under
  strict CSP.
- Pre-shell errors use the normal 500 page-error path. Post-shell errors are
  reported but cannot change the committed status. Cancelling the body aborts
  rendering without application-error reporting.
