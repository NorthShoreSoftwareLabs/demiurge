# Demiurge

Demiurge is a React framework for secure routing, server rendering, and
framework-managed HTML documents. An application can run in one production
Node process. Adapter boundaries support other deployment configurations.

## Requirements

- Node.js 22.13 or newer
- React and React DOM 19
- Vite 6 and `@vitejs/plugin-react` when the application uses the framework build

## Install

```sh
pnpm add @demiurgejs/core react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom
```

Define a route under `src/routes`:

```tsx
import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => <main>Hello from Demiurge</main>,
});
```

Page applications also own their root `src/routes/@not-found.tsx` so a missing
URL never falls back to framework-branded markup:

```tsx
export default function NotFound({ pathname }: { pathname: string }) {
  return <main>Nothing at {pathname}</main>;
}
```

Configure the application:

```ts
// demiurge.config.ts
import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  routing: { typedRoutes: true },
});
```

Run `demiurge dev` for development or `demiurge build` for production output.
Demiurge generates the Vite configuration from `demiurge.config.ts`. There is
no `index.html` to write: the framework renders the document and attaches CSP
nonces to what it emits.

Run `demiurge build` for static production output. Run `demiurge preview` to
serve that output with the headers in its manifest.

Production SSR uses a separate server build and a runtime adapter. The minimum
working setup is in the
[README quickstart](https://github.com/NorthShoreSoftwareLabs/demiurge#deploy),
and [Node deployment](https://github.com/NorthShoreSoftwareLabs/demiurge/blob/main/docs/guides/node-deployment.md)
covers host allowlists, proxy trust, timeouts, and graceful shutdown.

## Package entry points

- `@demiurgejs/core` — routes, document APIs, security, caching, and browser runtime
- `@demiurgejs/core/node` — production Node HTTP, SSR, and static-file adapter
- `@demiurgejs/core/static` — static-output adapter
- `@demiurgejs/core/redis` — Redis-backed cache store with cross-instance tag invalidation
- `@demiurgejs/core/config` — the application configuration contract
- `@demiurgejs/core/vite` — framework build internals
- `@demiurgejs/core/adapter/testing` — adapter capability conformance contract
- `@demiurgejs/core/deployment/testing` — deployment conformance kit for provider translation and production artifacts
- `@demiurgejs/core/data/testing` — cache-store conformance contract
- `@demiurgejs/core/internal/testing` — explicitly unstable test helpers

Vite is an optional peer dependency with `@vitejs/plugin-react`. A consumer
that only runs the built output does not install them.

## Support and license

Report defects through [GitHub Issues](https://github.com/NorthShoreSoftwareLabs/demiurge/issues).
Demiurge is available under the [MIT License](./LICENSE).
