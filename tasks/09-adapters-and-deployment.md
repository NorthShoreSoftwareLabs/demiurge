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

- Edge and static adapters still need platform-specific implementations.
- Streaming, WebSocket, shared-cache, and static-output contracts need broader
  adapter contract tests before they can be marked complete.
