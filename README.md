# Demiurge

A tiny React framework built one layer at a time.

## MVP 0.0.1

Demiurge starts with a file router powered by Vite's `import.meta.glob`, but the
route module model is already capability-based: route files own addresses, and
exports declare what can happen at that address.

Current conventions:

- framework source lives under `src`
- public API is exported from `demiurge`
- test-only internals are exported from `demiurge/internal/testing`
- example apps live under `examples`
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

Current source modules:

- `src/route`: route capability helpers and public route types
- `src/router`: file-route manifest, matching, and route loading
- `src/browser`: browser router and `<Link />`
- `src/internal`: explicit test-only framework internals

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
