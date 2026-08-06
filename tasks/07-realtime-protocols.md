# Realtime Protocols

Status: planned

## Goal

Routes should support realtime protocols without pretending every route is a
page or ordinary request/response endpoint.

## Features To Implement

- SSE helper over normal HTTP.
- JSONL/readable stream helper over normal HTTP.
- `WS` WebSocket route capability.
- WebSocket origin checks, auth hooks, and subprotocol allowlists.
- WebRTC signaling helpers built on HTTP/WebSocket capabilities.
- WebTransport capability once adapter support is clear.

## Examples Required

- `examples/sse-feed`
- `examples/websocket-chat`
- `examples/webrtc-signaling`

## Tests Required

- Server tests for stream headers and chunking.
- Adapter tests for WebSocket capability support.
- Security tests for WebSocket origin checks.

## Open Decisions

- Whether WebRTC gets first-class route helpers or documented composition
  patterns around HTTP plus WebSocket signaling.
