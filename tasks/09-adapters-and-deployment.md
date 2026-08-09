# Adapters And Deployment

Status: in progress

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

## Implemented Slices

- The production Node adapter converts Node HTTP requests and responses to the
  web platform contract, serves safe static assets, preserves repeated
  `Set-Cookie` headers, and exposes `createNodeServer(...)` from `demiurge/node`.
- Vite production builds emit a client manifest containing the client entry and
  hashed stylesheets. The framework-owned SSR server entry loads route modules
  and creates a request handler that can be mounted by the Node adapter.
- `examples/node-server` exercises the client build, SSR build, API routes,
  dynamic pages, stylesheet assets, and the production Node server together.
- `defineAdapter(...)`, `checkAdapterCapabilities(...)`, and
  `assertAdapterCapabilities(...)` provide the first adapter capability contract
  for nonce injection, streaming, WebSocket, WebTransport, cross-origin
  isolation headers, static output, and shared cache support.

## Open Decisions

- Edge and static adapters still need platform-specific implementations.
- Streaming, WebSocket, shared-cache, and static-output contracts need broader
  adapter contract tests before they can be marked complete.
