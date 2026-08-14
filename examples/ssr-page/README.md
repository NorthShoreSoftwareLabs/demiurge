# ssr-page

This minimal Demiurge application demonstrates server rendering and client
hydration. A route `data` loader runs only on the server. Layout metadata flows
into the document head.

## Routes

- `/` (`src/routes/index.tsx`) — the home page. Its `data` loader computes a
  server timestamp and a checksum derived from that timestamp, then renders
  both values on the page.
- `/widgets` (`src/routes/widgets/index.tsx`) — an index route that links to
  each widget.
- `/widgets/[id]` (`src/routes/widgets/[id].tsx`) — a dynamic route. The file
  segment `[id]` becomes `path.id` inside the route component. Demiurge uses
  `path` for this, never `params`.
- `/stream` (`src/routes/stream.tsx`) — a streaming route for development
  browser verification.
- `src/routes/@layout.tsx` — the root layout. It defines the site header, the
  navigation, and the `metadata` and `links` that every route under it
  inherits.
- `src/routes/@not-found.tsx` — the fallback for unmatched paths.
- `src/routes/@policy.ts` — the strict document policy used in production and
  development.

## What to look at, and why

**The server-only data loader.** `src/routes/index.tsx` exports
`GET = page({ data, view })`. The `data` function runs on the server as part
of handling the request. It never runs again in the browser. When development
SSR is wired up (see the caveat below), viewing source on `/` will show two
places where the loader's output appears:

1. Rendered directly into the HTML body, inside the `<dl class="stamp">`
   block, because the server already ran the loader before sending markup.
2. Serialized into an inert `<template id="__demiurge_data">` near the end of
   `<body>`. `hydrateFileRouter` reads this bootstrap payload on the client.
   It does not call `data` again. Hydration does not fetch data that the server
   already computed.

Reload the page. The new server request changes the timestamp and checksum.
Use a `<Link />` to navigate away and back in the running application. The
values do not change because the client transition reuses the hydrated router
state.

**Hydration markers.** The server-rendered root element carries a
`data-demiurge-hydrate` attribute (visible on `<div id="root">` in
view-source). The client only hydrates when it finds that attribute and
matching body markup. These values identify a real server render and distinguish
it from an empty shell.

**Metadata cascade.** `src/routes/@layout.tsx` defines a default title
format, a description, and an Open Graph image through `defineMetadata`.
`src/routes/widgets/index.tsx` and `src/routes/widgets/[id].tsx` each supply
their own `title` and `description`. These values override the layout defaults
for that route. Each route still inherits unset values, such as the Open Graph
image. View source on any route to see the
resolved `<title>`, `<meta name="description">`, and Open Graph tags in the
document `<head>`.

**Dynamic routes without `params`.** `src/routes/widgets/[id].tsx` reads
`path.id` from its `RouteProps`. The framework calls this `path`
to use one term for values in a route address. Code uses this term in a `data`
loader, a route view, and a `<Link path={{ id }} />` call.

**Client navigation.** `src/routes/@layout.tsx` and every route use
`<Link />` for internal navigation. After hydration, clicking these links
updates the URL and swaps the rendered route without a full page reload.

## Dev-mode SSR

The Vite plugin sends page requests through the same route and rendering
pipeline as the production request handler. Running `pnpm dev` therefore
shows the server-rendered body and `__demiurge_data` payload in view source,
while Vite still adds its development client and transforms. The root policy
also verifies Fast Refresh with a strict CSP.
