# Getting Started

Demiurge requires Node 22.13 or newer, React 19, and Vite 6.

## Create an application

Run the scaffold and select a page or API template:

```sh
npm create demiurge
```

The page template includes the root layout, fallback documents, policy, styles,
and Vite configuration. The API template does not include page-route files.

## Install

```sh
pnpm add @demiurgejs/core react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

## Configure Vite

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [demiurge({ typedRoutes: true }), react()],
});
```

## Add the first route

```tsx
// src/routes/index.tsx
import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => <main>Hello from Demiurge</main>,
});
```

Page applications must own their root not-found document:

```tsx
// src/routes/@not-found.tsx
import type { NotFoundProps } from "@demiurgejs/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing at {pathname}</main>;
}
```

Run `vite` for development and `vite build` for a browser build. The framework
creates the HTML document and browser entry. The application does not need an
`index.html` or a manual React mount.

For static production output, run `demiurge build`. Run `demiurge preview` to
serve the output with its declared headers.

For Vercel, select `vercelStatic()` in the Vite configuration. The build then
creates Build Output API artifacts under `.vercel/output`.

Continue with the [route reference](./reference/routes.md). For production SSR,
follow the [Node deployment guide](./guides/node-deployment.md).
