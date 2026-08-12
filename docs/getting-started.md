# Getting Started

Demiurge requires Node 22.13 or newer, React 19, and Vite 6.

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

Continue with the [route reference](./reference/routes.md). For production SSR,
follow the [Node deployment guide](./guides/node-deployment.md).
