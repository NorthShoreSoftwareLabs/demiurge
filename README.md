<p align="center">
  <img src="./assets/logo.png" alt="Demiurge" width="200">
</p>

<h1 align="center">Demiurge</h1>

<p align="center">
  A React framework for secure routing, server rendering, and framework-managed HTML documents.
</p>

---

A route file owns an address. Its exports declare pages, API responses,
redirects, streams, and mutations. The framework uses one document pipeline
for metadata, scripts, resource hints, and Content Security Policy.

Applications declare security policy beside the routes that use it. Policy
files cascade through the route tree, and explicit exceptions appear in the
route audit. This structure keeps effective policy visible without one remote
configuration file.

```tsx
// src/routes/blog/[slug].tsx
import { page } from "@demiurgejs/core";

export const GET = page({
  data: ({ cache, path }) =>
    cache.get({ fn: () => loadPost(path.slug), key: ["post", path.slug], ttl: "5m" }),
  view: ({ data }) => <article>{data.title}</article>,
});
```

## Quickstart

Demiurge needs Node 22.13 or newer, React 19, and Vite 6.

```sh
pnpm add @demiurgejs/core react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [demiurge({ typedRoutes: true }), react()],
});
```

```tsx
// src/routes/index.tsx
import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => <main>Hello from Demiurge</main>,
});
```

```tsx
// src/routes/@not-found.tsx
import type { NotFoundProps } from "@demiurgejs/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing at {pathname}</main>;
}
```

Run `vite` for development. Production commands depend on the deployment
target. The deployment guides provide complete build and start commands.

There is no `index.html` to write. The framework renders the document, injects
the client entry and stylesheets, and attaches CSP nonces to everything it
emits. The root `@not-found.tsx` is required for page applications, and the
build fails without it, because a missing URL should never fall back to
framework-branded markup.

## Routing

Files under `src/routes` map to addresses:

| File | Address |
| --- | --- |
| `index.tsx` | `/` |
| `blog/index.tsx` | `/blog` |
| `blog/[slug].tsx` | `/blog/:slug` |
| `docs/[...path].tsx` | `/docs/*` |
| `(marketing)/about.tsx` | `/about` |
| `api/health.tsx` | `/api/health` |

Dynamic values arrive as `path`, not `params`. Route groups in parentheses
organize files without appearing in the URL.

Exports declare capabilities at the address:

```tsx
export const GET = page({ view: Post });                       // rendered document
export const POST = json(createComment);                       // JSON endpoint
export const paths = () => slugs.map((slug) => ({ slug }));    // paths to prerender
```

Helpers describe what a handler produces: `page`, `json`, `text`, `html`,
`redirect`, `notFound`, `response`, plus SSE, JSONL, and readable-stream
helpers. `throw httpError(403, "Not your widget")` maps an intentional failure
to an error document or an RFC 9457 problem response without losing its status.

Framework-attached files use `@` so ordinary names stay available to the app.
`@policy.ts` is inherited policy. `policy.ts` is the real `/policy` route.

| File | Role |
| --- | --- |
| `@layout.tsx` | Wraps every page-compatible route below it |
| `@loading.tsx` | Suspense fallback for its subtree |
| `@not-found.tsx` | App-owned 404 document |
| `@error.tsx` | App-owned error document |
| `@middleware.ts` | HTTP middleware cascade |
| `@policy.ts` | Security policy cascade |

With `typedRoutes: true`, the plugin generates a URL manifest. `Link` and `href`
then reject unknown addresses. They also require the path variables that a
dynamic route declares.

## Security

Policy is inherited down the route tree from `@policy.ts` files:

```ts
import { security } from "@demiurgejs/core";

export const policy = {
  document: security.strict(),
};
```

The strict preset supplies a nonce-based CSP with `'strict-dynamic'`, HSTS,
`frame-ancestors 'none'`, `nosniff`, a referrer policy, a permissions policy,
and same-origin COOP and CORP. The request pipeline protects
cookie-authenticated unsafe methods against CSRF. An explicit exception appears
in the route audit.

Strict means the strongest policy that cannot break a user at runtime. A build
cannot detect a third-party library that assigns a string to `innerHTML` in a
user browser. Default Trusted Types enforcement could therefore fail production
sessions. Trusted Types enforcement is a named option. Report-only mode moves
the directives to `Content-Security-Policy-Report-Only`.

Other security features include typed CORS, rate limits, request size limits,
webhook verification, WebSocket origin checks, CSP reports, cross-origin
isolation, and environment schema validation. See the
[security guide](./docs/guides/security.md) for the complete policy and audit
behavior.

Streaming SSR keeps the strict policy. React's flush payloads carry the request
nonce rather than escaping through an inline-script exception.

## Data and caching

Route `data` runs on the server and never re-runs in the browser after
navigation. The cache is explicit, and scope is part of the call:

```ts
export const GET = page({
  data: ({ cache }) =>
    cache.get({
      fn: loadDashboard,
      key: ["dashboard"],
      scope: "public",
      staleWhileRevalidate: "30s",
      tags: [tag("dashboard")],
      ttl: "5s",
    }),
  view: Dashboard,
});
```

Scopes are `build`, `public`, `private`, `request`, and `none`. Stale-while-
revalidate coordinates one refresh across replicas rather than letting every
request start its own. Custom stores implement a published contract, and
`@demiurgejs/core/data/testing` verifies an implementation against it.

## Documents

Layouts and routes contribute to the document, and contributions cascade:

```tsx
export const metadata = defineMetadata({
  description: "A small Demiurge blog.",
  title: { default: "Demiurge Blog", format: (title) => `${title} | Demiurge Blog` },
});
export const links = defineLinks([preload("/shell.js", { as: "script" })]);
export const scripts = defineScripts([script({ src: "/shell.js", strategy: "afterInteractive" })]);
```

The document renderer collects, dedupes, orders, and checks these against the
final security policy. Sitemap, robots, structured data, and OG image helpers
use the same pipeline.

## Deploy

### Node

The Node adapter runs browser and SSR bundles in one production process. The
application currently provides a server entry that composes the request
handler, static assets, and process lifecycle.

`allowedHosts` is mandatory. The adapter ignores forwarded headers until the
application names a trusted proxy. The static root rejects traversal and
symlinks. See [Node deployment](./docs/guides/node-deployment.md) for the current
server entry, build commands, timeouts, graceful shutdown, and shared stores.

### Static

`@demiurgejs/core/static` prerenders pages, resolves `paths` exports for dynamic routes,
and writes an app-owned `404.html`. It emits `demiurge-static-manifest.json`
recording the response headers a host must apply at each path, which keeps the
adapter independent of any one provider's configuration format. The build fails
on redirects, render errors, response cookies, unsafe output paths, or CSP that
depends on a fixed nonce.

### Edge

`@demiurgejs/core/edge` runs the same request pipeline on a Web-platform
runtime. It streams through a Web `ReadableStream` and serves static assets from
a bundled asset map instead of a filesystem. It also refuses to fall back to an
in-memory cache or rate limit store:

```js
import { createEdgeRequestHandler } from "@demiurgejs/core/edge";
import { createHandler, routes } from "./dist/server/server-entry.js";

const handler = createEdgeRequestHandler({
  assets: { assets: bundledAssets },
  cacheStore: "unavailable",
  clientIp: (request) => request.headers.get("x-real-ip"),
  rateLimitStore: "unavailable",
  routes,
});

export default { fetch: handler };
```

`cacheStore` and `rateLimitStore` are mandatory. An edge deployment runs many
isolates, so an in-memory store counts one client in several buckets. See
[Edge deployment](./docs/guides/edge-deployment.md) for the declared capability
set and the failure each option produces.

`defineAdapter` and `assertAdapterCapabilities` let a build reject a target that
cannot provide something the app uses. `@demiurgejs/core/adapter/testing` holds
the contract behind those flags. Every adapter runs the same suite and proves
each capability it declares.

## Examples

Each example consumes the built `@demiurgejs/core` package through its public
exports. These examples are useful starting points:

| Example | Shows |
| --- | --- |
| [`basic-blog`](./examples/basic-blog) | File routes, layouts, dynamic paths, middleware, policy |
| [`ssr-page`](./examples/ssr-page) | Server rendering, hydration, route data |
| [`node-server`](./examples/node-server) | Production Node process, API routes, hashed assets |
| [`streaming-page`](./examples/streaming-page) | Suspense streaming under strict CSP |
| [`runtime-server-data`](./examples/runtime-server-data) | Cache scopes against a live HTTP source |
| [`app-owned-fallbacks`](./examples/app-owned-fallbacks) | Nested loading, not-found, and error ownership |
| [`static-export`](./examples/static-export) | Prerendering, dynamic `paths`, deployment headers |
| [`sse-feed`](./examples/sse-feed) | `sse(...)` headers and browser `EventSource` reconnect |
| [`webhook-security`](./examples/webhook-security) | `webhook.hmac(...)` signature checks against the raw body |
| [`observability`](./examples/observability) | `serverTiming(...)` metrics in a real `Server-Timing` response header |

## Documentation

- [Documentation index](./docs/README.md)
- [Getting started](./docs/getting-started.md)
- [Route reference](./docs/reference/routes.md)
- [Security guide](./docs/guides/security.md)
- [Data and caching](./docs/guides/data-and-caching.md)
- [Errors and not-found behavior](./docs/guides/errors-and-not-found.md)
- [Node deployment](./docs/guides/node-deployment.md)
- [Edge deployment](./docs/guides/edge-deployment.md)

Maintainers and contributors can also read the [architecture records](./architecture/README.md),
[open design discussions](https://github.com/NorthShoreSoftwareLabs/demiurge/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-decision), and [contribution guide](./CONTRIBUTING.md).

## Status

Demiurge is under prerelease development. The latest signed tag is
`v0.2.0-beta.3`. Changes after that tag are Unreleased. The package metadata
identifies the current prepared version.

The framework implements routing, SSR, Suspense streaming, static output, Node
and edge adapters, Vercel static output, and the managed document pipeline. It
also implements cache stores, image optimization, security policy, and the
`npm create demiurge` scaffold.

React Server Components and React Server Functions are not implemented. The
current SSR pipeline supports React `use(promise)` with Suspense. GitHub issues
and milestones are the only source for planned work and delivery status.

## Working on the framework

The published package lives in `packages/core`. The examples consume its built
output through `node_modules`. Verification checks package exports, emitted
declarations, peer dependencies, and production behavior. Examples do not
import framework source files.

```sh
pnpm install
pnpm dev                      # build the library, then run examples/basic-blog
pnpm dev:lib                  # rebuild the library on change in a second terminal
pnpm typecheck
pnpm test
pnpm verify                   # everything the CI pipeline runs
```

`pnpm test:browser` builds the production Node example. Chromium checks SSR
hydration, client navigation, CSP, security headers, cookies, Fetch Metadata,
and application-owned 404 responses.
Install the browser once with `pnpm exec playwright install chromium`.

`pnpm test:pack` packs the tarball, installs it into a scratch app, and imports
every entry point. It checks the shipped metadata, README, license,
declarations, cache-store conformance API, and a clean consumer's typecheck and
Vite production build. That is the only check that sees the package the way a
consumer does.

Framework source modules under `packages/core/src`:

| Module | Owns |
| --- | --- |
| `document` | Metadata, scripts, links, SEO, document rendering |
| `route` | Route capability helpers and public route types |
| `router` | File-route manifest, matching, and loading |
| `browser` | Browser router and `<Link />` |
| `server` | Request handling for HTTP route capabilities |
| `node` | Production Node HTTP adapter and static asset handler |
| `static` | Prerendering and static deployment manifests |
| `vite` | Vite integration |
| `internal` | Explicitly test-only internals |

## License

[MIT](./LICENSE)
