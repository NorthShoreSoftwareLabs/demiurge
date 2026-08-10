# ssr-page

A minimal Demiurge app that demonstrates server rendering with client
hydration, a route `data` loader that runs only on the server, and metadata
that cascades from a layout down into the document head.

## Routes

- `/` (`src/routes/index.tsx`) — the home page. Its `data` loader computes a
  server timestamp and a checksum derived from that timestamp, then renders
  both values on the page.
- `/widgets` (`src/routes/widgets/index.tsx`) — an index route that links to
  each widget.
- `/widgets/[id]` (`src/routes/widgets/[id].tsx`) — a dynamic route. The file
  segment `[id]` becomes `path.id` inside the route component. Demiurge uses
  `path` for this, never `params`.
- `src/routes/@layout.tsx` — the root layout. It defines the site header, the
  navigation, and the `metadata` and `links` that every route under it
  inherits.
- `src/routes/@not-found.tsx` — the fallback for unmatched paths.

## What to look at, and why

**The server-only data loader.** `src/routes/index.tsx` exports
`GET = page({ data, view })`. The `data` function runs on the server as part
of handling the request; it never runs again in the browser. Once dev-mode
SSR is wired up (see the caveat below), viewing source on `/` will show two
places where the loader's output appears:

1. Rendered directly into the HTML body, inside the `<dl class="stamp">`
   block, because the server already ran the loader before sending markup.
2. Serialized into an inert `<template id="__demiurge_data">` near the end of
   `<body>`. This is the bootstrap payload that
   `hydrateFileRouter` reads on the client instead of calling `data` again,
   so hydration does not re-fetch anything the server already computed.

Reload the page and the timestamp and checksum change, because that is a new
server request. Click a `<Link />` to navigate away and back within the
running app and they do not change, because that is a client-side
transition that reuses the already-hydrated router state.

**Hydration markers.** The server-rendered root element carries a
`data-demiurge-hydrate` attribute (visible on `<div id="root">` in
view-source). The client only hydrates when it finds that attribute and
matching body markup; this is how it tells a real server render apart from
an empty shell.

**Metadata cascade.** `src/routes/@layout.tsx` defines a default title
format, a description, and an Open Graph image through `defineMetadata`.
`src/routes/widgets/index.tsx` and `src/routes/widgets/[id].tsx` each supply
their own `title` and `description`, which override the layout's defaults
for just that route while still inheriting anything they do not set (the
Open Graph image, for instance). View source on any route to see the
resolved `<title>`, `<meta name="description">`, and Open Graph tags in the
document `<head>`.

**Dynamic routes without `params`.** `src/routes/widgets/[id].tsx` reads
`path.id` from its `RouteProps`. The framework calls this `path`
deliberately, to keep one vocabulary for "the values this route's own
address contains," whether you are inside a `data` loader, a route view, or
a `<Link path={{ id }} />` call.

**Client navigation.** `src/routes/@layout.tsx` and every route use
`<Link />` for internal navigation. After hydration, clicking these links
updates the URL and swaps the rendered route without a full page reload.

## Dev-mode SSR

The Vite plugin sends page requests through the same route and rendering
pipeline as the production request handler. Running `pnpm dev` therefore
shows the server-rendered body and `__demiurge_data` payload in view source,
while Vite still adds its development client and transforms.
