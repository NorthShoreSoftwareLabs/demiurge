<p align="center">
  <img src="./assets/logo.png" alt="Demiurge" width="200">
</p>

<h1 align="center">Demiurge</h1>

<p align="center">A tiny React framework built one layer at a time.</p>


## MVP 0.0.1

Demiurge starts with a file router powered by Vite's `import.meta.glob`, but the
route module model is already capability-based: route files own addresses, and
exports declare what can happen at that address.

Current conventions:

- framework source lives under `src`
- public API is exported from `demiurge`
- test-only internals are exported from `demiurge/internal/testing`
- example apps live under `examples`
- `examples/ssr-page` demonstrates server rendering, hydration, and route data
- `examples/node-server` demonstrates a production Node server with SSR, API
  routes, and hashed static assets
- `examples/streaming-page` demonstrates Suspense streaming with strict CSP
  nonce propagation
- `examples/static-export` demonstrates prerendered pages, dynamic `paths`,
  deployment headers, and an app-owned static 404
- `examples/basic-blog/src/routes/index.tsx` maps to `/`
- `examples/basic-blog/src/routes/blog/index.tsx` maps to `/blog`
- `examples/basic-blog/src/routes/blog/[slug].tsx` maps to `/blog/:slug`
- `examples/basic-blog/src/routes/@layout.tsx` wraps every page-compatible route
- `examples/basic-blog/src/routes/blog/@layout.tsx` wraps every page-compatible route below `/blog`
- route files export `GET = page(...)`
- dynamic path values are exposed as `path`, not `params`
- `throw httpError(403, "Not your widget")` maps an intentional failure to an
  error document or RFC 9457 problem response without losing its status

Example route:

```tsx
import { page } from "demiurge";

export const GET = page({
  view: ({ path }) => <Post slug={path.slug} />,
});
```

Run it with:

```sh
npm install
npm run dev
```

Run the checks with:

```sh
npm run typecheck
npm test
npm run build
```

## Production Node quickstart

A production app builds two bundles. The browser bundle contains route chunks,
styles, and `demiurge-manifest.json`; the SSR bundle contains a generated route
map and request-handler factory.

Expose the framework-owned SSR entry from an application file:

```ts
// src/server-entry.ts
export { createHandler, routes } from "virtual:demiurge/server-entry";
```

Build the browser and server entries separately:

```json
{
  "scripts": {
    "build": "vite build --outDir dist/client && vite build --ssr src/server-entry.ts --outDir dist/server",
    "start": "node server.js"
  }
}
```

Then create the Node process that reads the browser manifest, configures SSR,
and serves hashed client assets before route requests:

```js
// server.js
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer, renderNodePageResponse } from "demiurge/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);
const handler = createHandler({
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);

createNodeServer({
  handler,
  static: { root },
}).listen(port, host);
```

Run `npm run build`, then start the built application with
`NODE_ENV=production npm start`. Deploy `dist/client`, `dist/server`,
`server.js`, `package.json`, and installed production dependencies together.
Set `HOST=0.0.0.0` when the process must accept traffic directly from a
container or network interface.

[`examples/node-server`](./examples/node-server) is the complete working
version, including Vite configuration, typed virtual-module declarations, SSR
and API routes, app-owned fallbacks, and inherited security policy.

## Repository layout

The library lives in `packages/demiurge` and is consumed by the examples the
same way a published install would be. Examples are npm workspaces that depend
on `demiurge` and resolve it through `node_modules`, so the package's `exports`
map, its emitted declarations, and its peer dependencies are all exercised by
the normal build rather than bypassed by a path alias.

Because of that, the examples read the library's `dist`, not its source. Build
it once with `npm run build -w demiurge`, or run `npm run dev:lib` in a second
terminal to rebuild on change while you work on an example.

`npm run test:pack` packs the tarball, installs it into a scratch app, and
imports every entry point. That is the only check that sees the package the way
a consumer does.

For a static production build, run
`npm run build -w examples/static-export`. The example writes rendered pages
and `404.html` into `dist/`; its `demiurge-static-manifest.json` records the
headers a static hosting provider must apply at each path.

Current source modules, all under `packages/demiurge/src`:

- `document`: metadata, scripts, links, SEO, and the document renderer
- `route`: route capability helpers and public route types
- `router`: file-route manifest, matching, and route loading
- `browser`: browser router and `<Link />`
- `server`: request handling for HTTP route capabilities
- `node`: production Node HTTP adapter and static asset handler
- `static`: production prerendering and static deployment manifest generation
- `vite`: Vite integration for development
- `internal`: explicit test-only framework internals

## Design notes

- [Framework vision](./docs/00-framework-vision.md)
- [Route capabilities](./docs/01-route-capabilities.md)
- [Security and strict CSP](./docs/02-security-csp.md)
- [Implementation roadmap](./docs/03-implementation-roadmap.md)
- [Data and static generation](./docs/04-data-and-static-generation.md)
- [Platform features and integrations](./docs/05-platform-features.md)
- [MVP 0.0.1](./docs/06-mvp-0.0.1.md)
- [Feature inventory](./docs/07-feature-inventory.md)
- [Testing strategy](./docs/08-testing-strategy.md)
