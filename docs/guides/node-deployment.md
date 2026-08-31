# Node Deployment

The Node adapter runs a built Demiurge app as one production HTTP process. It
owns the request boundary, the static file boundary, and the process lifecycle.
This document covers the operational settings. The
[README quickstart](../../README.md#deploy) covers the minimum working setup, and
[`examples/node-server`](../../examples/node-server) is the complete version.
Deploying this process inside a container follows the
[container deployment contract](./container-deployment-contract.md), which
separates the rules below from settings a specific platform chooses. See the
[deployment capability matrix](./deployment-capability-matrix.md) for what the
Node adapter proves against the shared adapter contract.

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

## The production process

`serveNodeBuild(...)` owns the bootstrap. It reads the browser manifest, serves
the client build, resolves the bind address and the host allowlist, answers the
readiness path, and listens.

```js
// server.js
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page }) => createHandler(page),
  name: "Demiurge server",
  port: 4173,
});
```

`base` is the `import.meta.url` of `server.js`. The helper resolves
`dist/client` against it, so the process finds its own build wherever the image
puts it. Set `clientDir` when the client build lands somewhere else.

`createHandler` receives the manifest `page` options, the resolved client
`root`, and a `waitUntil` binding for the server that does not exist yet. Pass
that binding to a cache store, and return a wrapped handler when the app owns
paths of its own:

```js
await serveNodeBuild({
  base: import.meta.url,
  createHandler({ page, waitUntil }) {
    const routes = createHandler({
      ...page,
      cacheStore: { namespace, store, waitUntil },
    });

    return (request) =>
      new URL(request.url).pathname === "/healthz"
        ? new Response("ok")
        : routes(request);
  },
  port: 4173,
});
```

An application that needs a different process shape can still call
`createNodeServer(...)` directly. The helper is a default, not a boundary.

## Host allowlist

`allowedHosts` is mandatory. The adapter checks the request authority before it
becomes a Web `Request` URL, so a forged `Host` header never reaches route code
or absolute-URL generation.

List the public hostnames the app answers to, including ports when a port must
be exact. This is not the bind address. `HOST` decides which interface the
process listens on. Set `HOST=0.0.0.0` when a container or platform connects to
the process directly.

`serveNodeBuild(...)` reads the allowlist from `ALLOWED_HOSTS` as a
comma-separated list. Without that variable it allows the bind address and
`localhost`. Pass `allowedHosts` to state the list in code instead.

## Trusted proxies

Forwarded headers are ignored by default, because a process that trusts
`X-Forwarded-For` from anyone has no client address at all.

Behind exactly one trusted reverse proxy, configure `trustProxy: { hops: 1 }`.
Where proxy addresses are stable, prefer
`trustProxy: { ranges: ["10.0.0.0/8"] }`. Demiurge then resolves the client
address, scheme, and host right-to-left through that boundary. Never enable
proxy trust on a process clients can reach around the proxy. See the
[CDN and reverse-proxy contract](./cdn-reverse-proxy-contract.md) for the full
requirements a proxy must satisfy.

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
the grace deadline. Hosts that own signals themselves should call
`await server.shutdown()` directly instead of configuring `signals`.

## Readiness endpoint

A readiness endpoint must return `503` as soon as `isReady()` is false, so the
load balancer stops sending new traffic while in-flight requests finish.

`readyPath` serves that endpoint. It answers `200` with `ready` while the server
is ready, and `503` with `draining` once shutdown starts. Both answers carry
`cache-control: no-store`.

```js
const server = createNodeServer({
  allowedHosts: ["app.example.com"],
  handler,
  readyPath: "/.well-known/ready",
});
```

`serveNodeBuild(...)` sets `/.well-known/ready` by default. Pass a different
path to move it, or `readyPath: false` to let route code own that path.

A draining server refuses new connections, so a probe that opens a fresh
connection sees a refused connection rather than a `503`. Point the probe at a
balancer that reuses connections, or read the `503` as the stronger signal when
it arrives.

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
`AbortSignal`. Pass it to `fetch(...)` and database drivers that accept it.
Also pass it to applicable SDKs. A browser disconnect can then stop upstream
work and an unnecessary render.

## Shared cache and background work

`createHandler(...)` accepts a `CacheStore`. Every request still gets its own
cache facade, so one request cannot read another's private entries.

The in-memory store is limited to one Node process. A deployment with multiple
replicas should inject a shared Redis or KV implementation that passes the
conformance contract in `@demiurgejs/core/data/testing`.

Stale-while-revalidate refreshes are handed to `server.waitUntil(...)`, so
shutdown drains them within the grace period rather than abandoning a
publication mid-write. Under `serveNodeBuild(...)`, pass the `waitUntil` binding
from the `createHandler` context to the cache store.

## What to deploy

Ship `dist/client`, `dist/server`, `server.js`, `package.json`, and installed
production dependencies together. The server defaults to `127.0.0.1:4173`.
Override `PORT` and `HOST` for the target environment.
