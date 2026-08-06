# Rendering SSR Streaming And RSC

Status: planned

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

- Whether initial RSC data is delivered through a nonce-backed script,
  non-executable JSON script, or separate fetch.
