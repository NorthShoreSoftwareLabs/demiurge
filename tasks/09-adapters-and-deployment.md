# Adapters And Deployment

Status: planned

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

- Which adapter ships first after Vite dev: Node is probably the best next
  runtime because it unlocks SSR, streaming, WebSocket, and Cloud Run.
