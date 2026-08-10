# Adapters And Deployment

Tracking: #11

## Goal

Deployment targets should declare capabilities so framework features fail
clearly when an adapter cannot support streaming, nonce injection, realtime, or
shared caching.

## Features To Implement

- Node adapter.
- Edge adapter.
- Static adapter.
- Adapter capability checks.
- Cloud Run deployment guidance.
- Redis/shared cache adapter.
- KV cache adapter.
- Static output artifact generation.

## Examples Required

- `examples/node-server`
- `examples/static-export`
- `examples/cloud-run`

## Tests Required

- Shared adapter contract tests.
- Static adapter output tests.
- Streaming capability tests.
- Cache adapter tests.

## Open Decisions

- Which Edge runtime should pressure-test the next adapter contract.
- Whether provider-specific static header translators belong in the framework
  or in small deployment packages maintained alongside it.
- Streaming, WebSocket, and shared-cache contracts need broader adapter tests.

## Decisions Made

- The static adapter is provider-independent. It emits versioned HTML artifacts
  and a deployment manifest with per-path headers rather than silently choosing
  one host's configuration format.
- Static publication stages all rendered HTML before touching the output tree,
  preserves client assets, and removes stale HTML only when a previous valid
  Demiurge manifest proves ownership.
- Static output rejects runtime page modes, per-request nonces, response
  cookies, redirects, rendering failures, unsafe paths, and inline CSP content
  without a matching stable hash.
