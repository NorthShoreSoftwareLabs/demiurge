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
- `examples/static-export` demonstrates prerendered pages, dynamic `paths`,
  deployment headers, and an app-owned static 404
- `examples/basic-blog/src/routes/index.tsx` maps to `/`
- `examples/basic-blog/src/routes/blog/index.tsx` maps to `/blog`
- `examples/basic-blog/src/routes/blog/[slug].tsx` maps to `/blog/:slug`
- `examples/basic-blog/src/routes/@layout.tsx` wraps every page-compatible route
- `examples/basic-blog/src/routes/blog/@layout.tsx` wraps every page-compatible route below `/blog`
- route files export `GET = page(...)`
- dynamic path values are exposed as `path`, not `params`

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

For a production Node build, run `npm run build -w examples/node-server` and
then `npm start -w examples/node-server`. The example reads the generated
`demiurge-manifest.json`, mounts the framework-owned SSR server entry, and serves
the client assets through `createNodeServer(...)`.

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
