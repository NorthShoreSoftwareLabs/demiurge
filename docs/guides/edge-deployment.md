# Edge Deployment

The edge adapter runs a built Demiurge app on a Web-platform runtime. It takes a
`Request` and returns a `Response`, and it uses no Node built-in. That is the
common denominator across the runtimes that call themselves edge, so the adapter
targets the platform rather than one vendor.

The [Node deployment guide](./node-deployment.md) covers the process-shaped
deployment. This document covers what changes when the process is gone.

## What the adapter declares

An adapter declares a capability only when the shared contract suite in
`@demiurgejs/core/adapter/testing` proves it. The edge adapter declares three.

| Capability | Declared | Why |
| --- | --- | --- |
| `streaming` | true | React renders into a Web `ReadableStream` |
| `nonceInjection` | true | A per-request nonce comes from `crypto.getRandomValues` |
| `crossOriginIsolationHeaders` | true | The isolation headers travel on the returned response |
| `backgroundLifetime` | false | An isolate has no shutdown to drain work into |
| `sharedCache` | false | No shared store backend ships yet |
| `staticOutput` | false | A build artifact is the static adapter's job |
| `webSocket` | false | The framework owns no handshake here |
| `webTransport` | false | The framework owns no handshake here |

`backgroundLifetime` is the one that differs from Node for a structural reason.
A Node server can wait for background work at shutdown, so it declares the
capability and proves it. An isolate ends when the host decides. A host
`waitUntil` call is best effort, and the framework cannot promise the work
finished. Declaring the capability false is the honest answer.

A route policy that needs a capability the adapter lacks fails at startup
through `assertAdapterCapabilities`, not at the request that needed it.

## Creating the handler

```js
import { createEdgeRequestHandler } from "@demiurgejs/core/edge";
import { routes } from "./dist/server/server-entry.js";

const handler = createEdgeRequestHandler({
  assets: { assets: bundledAssets },
  cacheStore: "unavailable",
  clientIp: (request) => request.headers.get("x-real-ip"),
  rateLimitStore: "unavailable",
  routes,
  ssr: { clientEntry: manifest.clientEntry, styles: manifest.styles },
});

export default { fetch: handler };
```

The handler renders streaming pages with `renderEdgePageResponse` unless the
application passes its own `renderPage`.

## Static assets without a filesystem

An isolate has no persistent filesystem at request time, so the Node static
root does not exist here. `createEdgeAssetHandler` reads from an asset map the
build bundles into the deployment.

```js
import { createEdgeAssetHandler } from "@demiurgejs/core/edge";

const serveAsset = createEdgeAssetHandler({
  assets: {
    "/assets/app-abcdef12.js": { body: appSource },
    "/favicon.ico": { body: faviconBytes },
  },
  prefix: "/assets",
});
```

A body is a string, an `ArrayBuffer`, or a typed array. The map is the security
boundary. A request can reach only a pathname the map declares, so traversal,
symbolic links, and null bytes are unreachable rather than rejected. The handler
never serves `index.html` or `demiurge-manifest.json`, because the route
pipeline owns the shell document and its policy headers.

Each asset gets a content type from its extension, a `nosniff` header, a
`same-origin` resource policy, and an entity tag derived from its bytes. The
same build therefore produces the same validator in every isolate. A
content-hashed name is served as immutable, and every other name revalidates.
Byte ranges are not supported here, unlike the Node static handler.

## Cache and rate limit stores

`cacheStore` and `rateLimitStore` are both required. This is the difference that
matters most between the two adapters.

An edge deployment runs many isolates, and an isolate keeps its memory to
itself. An in-memory cache stores one value many times and expires it at many
different moments. An in-memory rate limit counts one client in many buckets, so
a limit of 100 admits 100 requests per isolate. Both look like working stores
and are not. The framework cannot detect the difference at runtime, so the
adapter refuses to pick a default.

Pass a shared store when the deployment has one:

```js
createEdgeRequestHandler({
  cacheStore: { namespace, store: sharedCacheStore },
  rateLimitStore: sharedRateLimitStore,
  routes,
});
```

A shared store must pass the conformance contract in
`@demiurgejs/core/data/testing`. Redis and KV backed stores are tracked
separately and do not ship yet.

Pass `"unavailable"` when the deployment has none:

```js
createEdgeRequestHandler({
  cacheStore: "unavailable",
  rateLimitStore: "unavailable",
  routes,
});
```

That installs stores which throw `EdgeSharedStoreError` rather than answering.
A `request` cache scope still works, because it never reaches the store. A
`build`, `private`, or `public` scope fails with a message naming the option to
set. Omitting either option throws at construction instead.

A rate limit policy is worse, because a silently per-isolate limit reads as an
enforced one. The handler scans `routeModules` at construction when it
receives them. It refuses to start if a route declares a rate limit policy while
`rateLimitStore` is `"unavailable"`.

## Client addresses

A rate limit keyed on `ip` needs the client address. An edge host reports it in
a header that the host owns, and the name differs per platform. The framework
does not guess. Pass `clientIp` to read the header your platform sets, and the
rate limit key uses that value.

## Request authority

The host builds the `Request`, so the adapter does not rederive the URL from
headers the way the Node adapter does. There is no `allowedHosts` option here.
Confirm that your platform pins the request authority before you rely on
absolute URL generation.
