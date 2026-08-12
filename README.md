<p align="center">
  <img src="./assets/logo.png" alt="Demiurge" width="200">
</p>

<h1 align="center">Demiurge</h1>

<p align="center">
  A React framework where the document, security policy, and route pipeline are the framework's job.
</p>

---

A route file owns an address, not a page. Its exports declare what can happen at
that address: a rendered page, a JSON endpoint, a redirect, a stream. The
framework owns the HTML document, so metadata, scripts, preloads, and a strict
Content-Security-Policy are generated as one pipeline instead of assembled by
hand in a template.

Defaults are the strict option, and relaxing one is a named declaration at the
route. `csrf: false` is a security audit you can run with `grep`. A config file
three directories away is not.

```tsx
// src/routes/blog/[slug].tsx
import { page } from "@demiurge/core";

export const GET = page({
  data: ({ cache, path }) =>
    cache.get({ fn: () => loadPost(path.slug), key: ["post", path.slug], ttl: "5m" }),
  view: ({ data }) => <article>{data.title}</article>,
});
```

## Quickstart

Demiurge needs Node 22.13 or newer, React 19, and Vite 6.

```sh
pnpm add @demiurge/core react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurge/core/vite";

export default defineConfig({
  plugins: [demiurge({ typedRoutes: true }), react()],
});
```

```tsx
// src/routes/index.tsx
import { page } from "@demiurge/core";

export const GET = page({
  view: () => <main>Hello from Demiurge</main>,
});
```

```tsx
// src/routes/@not-found.tsx
import type { NotFoundProps } from "@demiurge/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing at {pathname}</main>;
}
```

Run `vite` for development and `vite build` for a browser build.

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
`@policy.ts` is inherited policy; `policy.ts` is the real `/policy` route.

| File | Role |
| --- | --- |
| `@layout.tsx` | Wraps every page-compatible route below it |
| `@loading.tsx` | Suspense fallback for its subtree |
| `@not-found.tsx` | App-owned 404 document |
| `@error.tsx` | App-owned error document |
| `@middleware.ts` | HTTP middleware cascade |
| `@policy.ts` | Security policy cascade |

With `typedRoutes: true`, the plugin generates a URL manifest, so `Link` and
`href` reject addresses that do not exist and require the path variables a
dynamic route declares.

## Security

Policy is inherited down the route tree from `@policy.ts` files:

```ts
import { security } from "@demiurge/core";

export const policy = {
  document: security.strict(),
};
```

The strict preset ships a nonce-based CSP with `'strict-dynamic'`, HSTS,
`frame-ancestors 'none'`, `nosniff`, a referrer policy, a permissions policy,
and same-origin COOP and CORP. Cookie-authenticated unsafe methods get CSRF
protection whether or not a route asks for it, and `csrf: false` shows up in
the security audit.

Strict means the strongest policy that cannot break a user at runtime. Trusted
Types is a named opt-in for that reason: a violation is a third-party library
assigning a string to `innerHTML` in a browser you do not control, so enforcing
it by default would fail real sessions rather than a build. Report-only mode
moves the directives to `Content-Security-Policy-Report-Only`.

Also available: typed CORS, rate limiting, request and upload size limits,
webhook signature verification, WebSocket origin checks, a
cross-origin-isolated preset, a CSP reporting endpoint that parses both report
formats, and environment schema validation.

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
`@demiurge/core/data/testing` verifies an implementation against it.

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

A production app builds a browser bundle and an SSR bundle, then runs one Node
process that serves both:

```js
// server.js
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer, renderNodePageResponse } from "@demiurge/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "demiurge-manifest.json"), "utf8"));

const server = createNodeServer({
  allowedHosts: ["app.example.com"],
  handler: createHandler({
    clientEntry: manifest.clientEntry,
    renderPage: renderNodePageResponse,
    styles: manifest.styles,
  }),
  shutdown: { gracePeriod: 30_000, signals: ["SIGINT", "SIGTERM"] },
  static: { root },
});

server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? "127.0.0.1");
```

`allowedHosts` is mandatory, forwarded headers are ignored until you name a
trusted proxy, and the static root rejects traversal and symlinks. See
[Node deployment](./docs/11-node-deployment.md) for proxy trust, timeouts,
graceful shutdown, and shared cache stores.

### Static

`@demiurge/core/static` prerenders pages, resolves `paths` exports for dynamic routes,
and writes an app-owned `404.html`. It emits `demiurge-static-manifest.json`
recording the response headers a host must apply at each path, which keeps the
adapter independent of any one provider's configuration format. The build fails
on redirects, render errors, response cookies, unsafe output paths, or CSP that
depends on a fixed nonce.

Edge adapters are planned. `defineAdapter` and `assertAdapterCapabilities`
already let a build reject a target that cannot provide something the app uses.

## Examples

Each example is a workspace that installs `@demiurge/core` the way a published
consumer would.

| Example | Shows |
| --- | --- |
| [`basic-blog`](./examples/basic-blog) | File routes, layouts, dynamic paths, middleware, policy |
| [`ssr-page`](./examples/ssr-page) | Server rendering, hydration, route data |
| [`node-server`](./examples/node-server) | Production Node process, API routes, hashed assets |
| [`streaming-page`](./examples/streaming-page) | Suspense streaming under strict CSP |
| [`runtime-server-data`](./examples/runtime-server-data) | Cache scopes against a live HTTP source |
| [`app-owned-fallbacks`](./examples/app-owned-fallbacks) | Nested loading, not-found, and error ownership |
| [`static-export`](./examples/static-export) | Prerendering, dynamic `paths`, deployment headers |

## Documentation

- [Framework vision](./docs/00-framework-vision.md)
- [Route capabilities](./docs/01-route-capabilities.md)
- [Security and strict CSP](./docs/02-security-csp.md)
- [Data and static generation](./docs/04-data-and-static-generation.md)
- [Errors and not-found behavior](./docs/09-errors-and-not-found.md)
- [Platform features and integrations](./docs/05-platform-features.md)
- [Node deployment](./docs/11-node-deployment.md)
- [Feature inventory](./docs/07-feature-inventory.md)
- [Implementation roadmap](./docs/03-implementation-roadmap.md)
- [Testing strategy](./docs/08-testing-strategy.md)
- [Release process](./docs/10-release-process.md)

## Status

Demiurge 0.1.0 is the first public release. Routing, SSR, streaming, static
output, the Node adapter, the document pipeline, the cache, and the security
presets are implemented and tested. React Server Components, edge adapters, and the
`npm create demiurge-app` scaffold ([#22](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/22))
are not. [`docs/07-feature-inventory.md`](./docs/07-feature-inventory.md) tracks
every feature family and its state.

## Working on the framework

The library lives in `packages/demiurge` and the examples consume it through
`node_modules`, so the package's `exports` map, its emitted declarations, and
its peer dependencies are exercised by the normal build rather than bypassed by
a path alias. Examples read the library's `dist`, not its source.

```sh
pnpm install
pnpm dev                      # build the library, then run examples/basic-blog
pnpm dev:lib                  # rebuild the library on change in a second terminal
pnpm typecheck
pnpm test
pnpm verify                   # everything the CI pipeline runs
```

`pnpm test:browser` builds the production Node example and runs Chromium
conformance checks for SSR hydration, client navigation, CSP enforcement,
security headers, repeated secure cookies, Fetch Metadata, and app-owned 404s.
Install the browser once with `pnpm exec playwright install chromium`.

`pnpm test:pack` packs the tarball, installs it into a scratch app, and imports
every entry point. It checks the shipped metadata, README, license,
declarations, cache-store conformance API, and a clean consumer's typecheck and
Vite production build. That is the only check that sees the package the way a
consumer does.

Framework source modules under `packages/demiurge/src`:

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
