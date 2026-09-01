# Getting Started

Demiurge requires Node 22.13 or newer, React 19, and Vite 6.

## Create an application

Run the scaffold and select a page or API template:

```sh
npm create demiurge
```

The page template includes the root layout, fallback documents, policy, styles,
and the framework configuration file. The API template does not include
page-route files.

The scaffold carries the framework version. A prerelease scaffold publishes
under the `next` tag:

```sh
npm create demiurge@next
```

## Install

```sh
pnpm add @demiurgejs/core react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

## Configure the application

Each application has a `demiurge.config.ts` file at its root. Demiurge reads
this one file, and it generates the Vite configuration from it.

```ts
// demiurge.config.ts
import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  routing: { typedRoutes: true },
});
```

The file is required. A framework command fails when the file is absent, and
the diagnostic gives the expected path. The
[configuration guide](./guides/configuration.md) describes each boundary.

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

Run `demiurge dev` for development and `demiurge build` for production output.
The framework creates the HTML document and browser entry. The application does
not need an `index.html` or a manual React mount.

`demiurge build` writes the client bundle. It also writes static output when
the configuration declares `deployment.static`. Run `demiurge preview` to serve
that output with its declared headers.

For Vercel, select `vercelStatic()` as the static provider in
`demiurge.config.ts`. The build then creates Build Output API artifacts under
`.vercel/output`. The adapter does not require a Vercel package in the
application.

To optimize an image, follow the [image guide](./guides/images.md). It covers
the static build shape and the request-time optimizer.

Continue with the [route reference](./reference/routes.md). For production SSR,
follow the [Node deployment guide](./guides/node-deployment.md).
