# Deployment Capability Matrix

Every shipped deployment runs one of three adapters. Node deploys as a
process, edge deploys as a Web-platform isolate, and static deploys as build
output with no runtime process at all. Each adapter declares an
`AdapterCapabilityMap` from `@demiurgejs/core/adapter`, and the shared
contract suite in `@demiurgejs/core/adapter/testing` proves every declared
capability against a real deployment of that adapter. This document maps
required capabilities to the adapter and deployment path that support them.

This is a reference, not a status ledger. Planned or in-progress capability
work belongs in [GitHub Issues](https://github.com/NorthShoreSoftwareLabs/demiurge/issues),
not here. Every claim below cites the source or test that proves it today.

## Adapters and deployment paths

| Deployment path | Adapter | Guide |
| --- | --- | --- |
| Node process on a VM or bare-metal host | Node | [Node deployment](./node-deployment.md), [`examples/vm-node`](../../examples/vm-node) |
| Node process in a container | Node | [Cloud Run deployment](./cloud-run-deployment.md), [`examples/cloud-run`](../../examples/cloud-run) |
| Node process, general | Node | [Node deployment](./node-deployment.md), [`examples/node-server`](../../examples/node-server) |
| Web-platform isolate | Edge | [Edge deployment](./edge-deployment.md) |
| Static build output | Static | [`examples/static-export`](../../examples/static-export), [object-storage and CDN deployment](./object-storage-cdn-deployment.md), [`examples/object-storage-cdn`](../../examples/object-storage-cdn) |

The three Node deployment paths run the same adapter and therefore declare the
same capabilities. What differs between them is operational, not a
capability: bind address, TLS termination, and process supervision. The Node
and Cloud Run deployment guides cover those differences.

## How to read an unsupported cell

A route policy that needs a capability its adapter lacks fails at startup,
not at the request that needed it. Two enforced examples exist today.

- A document policy with a CSP nonce directive on an adapter without
  `nonceInjection` throws at startup. `assertAdapterCapabilities` reports the
  missing capability by name, proven by
  `packages/core/tests/static/output.test.tsx`.
- An edge handler configured with `cacheStore: "unavailable"` throws
  `EdgeSharedStoreError` the moment a route needs a `build`, `private`, or
  `public` cache scope. The same handler configured with
  `rateLimitStore: "unavailable"` refuses to start if any route declares a
  rate limit policy, proven by `packages/core/tests/edge/stores.test.ts` and
  `packages/core/tests/edge/handler.test.tsx`.

A capability with no automatic check still throws a clear, named error when
application code calls `assertAdapterCapabilities` directly, proven by
`packages/core/tests/adapter/capabilities.test.ts`.

## Capability matrix

| Capability | Node | Edge | Static |
| --- | --- | --- | --- |
| Streaming | Supported | Supported | Not supported |
| Request cancellation | Supported | Supported | Not applicable |
| Nonce injection | Supported | Supported | Not supported |
| Cross-origin isolation headers | Supported | Supported | Not supported |
| Static output | Not supported | Not supported | Supported |
| Background lifetime | Supported | Not supported | Not applicable |
| Shared cache (adapter-declared) | Not supported | Not supported | Not applicable |
| WebSocket | Not supported | Not supported | Not supported |
| WebTransport | Not supported | Not supported | Not supported |

Each row is proven by the contract test for its adapter:
`packages/core/tests/node/adapter-contract.test.tsx`,
`packages/core/tests/edge/adapter-contract.test.tsx`, and
`packages/core/tests/static/adapter-contract.test.tsx`. The `declares the
capabilities the contract proved` case in each file is the exact assertion
this table restates.

### Streaming and request cancellation

Node and edge both render a streaming shell through a Web `ReadableStream`,
proven by the `streaming` probe in each adapter's contract test. Both pass
the request's `AbortSignal` to route handlers, middleware, and data loaders,
so a client disconnect can stop upstream work. `AbortSignal` support comes
from `Request.signal` on the Fetch-standard `Request` object rather than a
separate adapter capability. See the
[Node deployment guide](./node-deployment.md#request-cancellation).

Static output has no request-time process, so streaming and cancellation do
not apply. A static build renders once and serves the same bytes to every
request.

### Nonce injection and security headers

Node and edge both generate a per-request nonce and return the cross-origin
isolation headers on the response. The `nonceInjection` and
`crossOriginIsolationHeaders` probes in each adapter's contract test prove
this. A policy that declares `security.crossOriginIsolated()` or a CSP nonce
directive works on both.

Static output renders once at build time, so no per-request nonce exists.
`packages/core/tests/static/output.test.tsx` proves that a static route with
a nonce-requiring policy fails at build time with a named
`nonceInjection` error, rather than shipping a broken policy.

### Static output

Only the static adapter declares `staticOutput`, proven by the `staticOutput`
probe in `packages/core/tests/static/adapter-contract.test.tsx`. The static
build writes a manifest and file set that a plain file host or CDN can serve
with no server process. `vercelStatic()` builds Vercel Build Output API
artifacts from the same static output, documented in
[getting-started](../getting-started.md).

### Background lifetime

Only Node declares `backgroundLifetime`, proven by the `backgroundLifetime`
probe in `packages/core/tests/node/adapter-contract.test.tsx`. Its shutdown
sequence drains `server.waitUntil(...)` work, including
`staleWhileRevalidate` refreshes, within the configured grace period. See the
[Node deployment guide](./node-deployment.md#timeouts-and-shutdown) and
[`examples/vm-node`](../../examples/vm-node), which proves a full drain on
`SIGTERM` in `tests/integration/vm-node.ts`.

Edge declares `backgroundLifetime: false`. A host `waitUntil` call there is
best effort, and the framework has no shutdown sequence to wait on inside an
isolate.

### Shared cache and rate limiting

No shipped adapter declares the `sharedCache` adapter capability. A shared
cache or rate limit store is an application-supplied dependency, not
something an adapter provides on its own. The framework never declares the
capability true for a deployment it does not control.

What ships and passes conformance testing:

- `createRedisCacheStore` from `@demiurgejs/core/redis` passes both
  conformance contracts in `@demiurgejs/core/data/testing`, proven by
  `packages/core/tests/redis/store.test.ts`.
- `createKvCacheStore` from `@demiurgejs/core/kv` passes the same contracts
  against a fake `EdgeKvNamespace`, proven by
  `packages/core/tests/kv/store.test.ts`.
- Redis and KV rate limit stores are proven by
  `packages/core/tests/redis/rate-limit-store.test.ts` and
  `packages/core/tests/kv/rate-limit-store.test.ts`.

Node accepts any of these as `cacheStore` or `rateLimitStore` and falls back
to an in-process memory store when neither is passed. A memory store does not
share entries across replicas, documented in the
[Node deployment guide](./node-deployment.md#shared-cache-and-background-work).

Edge requires an explicit `cacheStore` and `rateLimitStore`, including the
literal `"unavailable"`. Passing `"unavailable"` turns any shared cache scope
or rate limit policy into a startup or request-time `EdgeSharedStoreError`.
That replaces a silently per-isolate result, proven by
`packages/core/tests/edge/stores.test.ts`. See the
[Edge deployment guide](./edge-deployment.md#cache-and-rate-limit-stores).

Static output has no request-time cache or rate limit. Its `build` cache
scope resolves once during generation.

### WebSocket and WebTransport support

No shipped adapter declares `webSocket` or `webTransport`. None registers a
protocol upgrade handshake, proven by the `declares the capabilities the
contract proved` case in each adapter's contract test, where both flags come
back false. Calling `assertAdapterCapabilities(adapter, ["webSocket"])` or
`["webTransport"])` against any shipped adapter throws a named error rather
than failing silently, proven by
`packages/core/tests/adapter/capabilities.test.ts`. Track upgrade support as
a GitHub issue rather than expecting it from this table.
