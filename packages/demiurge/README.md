# Demiurge

Demiurge is a React framework where the document, security policy, route
pipeline, and deployment boundary are framework concerns. Applications can run
as one production Node process while retaining explicit adapter boundaries for
other deployment shapes.

## Requirements

- Node.js 22.13 or newer
- React and React DOM 19
- Vite 6 when using the `demiurge/vite` build integration

## Install

```sh
pnpm add demiurge react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom
```

Define a route under `src/routes`:

```tsx
import { page } from "demiurge";

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

Add the framework to Vite:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "demiurge/vite";

export default defineConfig({
  plugins: [demiurge({ typedRoutes: true }), react()],
});
```

Run `vite` for development or `vite build` for a browser build. Production SSR
uses a separate server build and a runtime adapter; the complete Node setup is
in the [production quickstart](https://github.com/NorthShoreSoftwareLabs/demiurge#production-node-quickstart).

## Package entry points

- `demiurge` — routes, document APIs, security, caching, and browser runtime
- `demiurge/node` — production Node HTTP, SSR, and static-file adapter
- `demiurge/static` — static-output adapter
- `demiurge/vite` — Vite framework plugin
- `demiurge/data/testing` — cache-store conformance contract
- `demiurge/internal/testing` — explicitly unstable test helpers

The Vite entry point is optional. Core, Node, and static consumers do not need
to install Vite unless their own build imports `demiurge/vite`.

## Support and license

Report defects through [GitHub Issues](https://github.com/NorthShoreSoftwareLabs/demiurge/issues).
Demiurge is available under the [MIT License](./LICENSE).
