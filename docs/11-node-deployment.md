# Node Deployment

The Node adapter runs a built Demiurge app as one production HTTP process. It
owns the request boundary, the static file boundary, and the process lifecycle.
This document covers the operational settings; the
[README quickstart](../README.md#deploy) covers the minimum working setup, and
[`examples/node-server`](../examples/node-server) is the complete version.

## Build outputs

A production app builds two bundles.

- The browser bundle contains route chunks, styles, and
  `demiurge-manifest.json`.
- The SSR bundle contains a generated route map and a request-handler factory.

Expose the framework-owned SSR entry from an application file so the server
build has something to compile:

```ts
// src/server-entry.ts
export { createHandler, routes } from "virtual:demiurge/server-entry";
```

```json
{
  "scripts": {
    "build": "vite build --outDir dist/client && vite build --ssr src/server-entry.ts --outDir dist/server",
    "start": "node server.js"
  }
}
```

`server.js` reads the browser manifest for the hashed client entry and
stylesheet paths, passes them to `createHandler(...)`, and serves hashed client
assets before route requests.

## Host allowlist

`allowedHosts` is mandatory. The adapter checks the request authority before it
becomes a Web `Request` URL, so a forged `Host` header never reaches route code
or absolute-URL generation.

List the public hostnames the app answers to, including ports when a port must
be exact. This is not the bind address. `HOST` decides which interface the
process listens on; set `HOST=0.0.0.0` when a container or platform connects to
the process directly.

## Trusted proxies

Forwarded headers are ignored by default, because a process that trusts
`X-Forwarded-For` from anyone has no client address at all.

Behind exactly one trusted reverse proxy, configure `trustProxy: { hops: 1 }`.
Where proxy addresses are stable, prefer
`trustProxy: { ranges: ["10.0.0.0/8"] }`. Demiurge then resolves the client
address, scheme, and host right-to-left through that boundary. Never enable
proxy trust on a process clients can reach around the proxy.

## Timeouts and shutdown

The server defaults to a 65-second keep-alive timeout, a 66-second header
timeout, and a five-minute request timeout. Tune these through the typed
`timeouts` option. Keep-alive should exceed the upstream load balancer's idle
timeout, and the header timeout should stay greater than keep-alive.

```js
const server = createNodeServer({
  allowedHosts: ["app.example.com"],
  handler,
  shutdown: { gracePeriod: 30_000, signals: ["SIGINT", "SIGTERM"] },
  static: { root },
});
```

The configured signal handler flips `server.isReady()` to false, stops accepting
connections, closes idle sockets, drains active responses, and force-closes at
the grace deadline. A readiness endpoint should return `503` as soon as
`isReady()` is false, so the load balancer stops sending new traffic while
in-flight requests finish. Hosts that own signals themselves should call
`await server.shutdown()` directly instead of configuring `signals`.

## Static files

The Node static handler treats its configured `root` as a security boundary. It
rejects traversal, malformed paths, null bytes, and symbolic links in any path
component. Copy real build artifacts into the public root rather than linking
assets from elsewhere in a monorepo.

Static responses include ETag and Last-Modified validators, answer matching
conditional requests with `304`, and support one byte range per request with
`206` and `416` responses.

## Request cancellation

Route handlers, middleware, and data loaders receive the request's
`AbortSignal`. Pass it to `fetch(...)`, database drivers, and SDKs that accept
one, so a browser disconnect stops upstream work instead of paying for a render
nobody will read.

## Shared cache and background work

`createHandler(...)` accepts a `CacheStore`. Every request still gets its own
cache facade, so one request cannot read another's private entries.

The in-memory store is limited to one Node process. A deployment with multiple
replicas should inject a shared Redis or KV implementation that passes the
conformance contract in `@demiurge/core/data/testing`.

Stale-while-revalidate refreshes are handed to `server.waitUntil(...)`, so
shutdown drains them within the grace period rather than abandoning a
publication mid-write.

## What to deploy

Ship `dist/client`, `dist/server`, `server.js`, `package.json`, and installed
production dependencies together. The server defaults to `127.0.0.1:4173`;
override `PORT` and `HOST` for the target environment.
