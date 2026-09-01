# Fonts

Demiurge self-hosts a font. The build publishes the font file from the
application origin, and the document reaches it through one stylesheet and one
preload link.

Self-hosting is the default because a third-party font host costs more than
performance. Such a host is a `font-src` entry, and every visitor reveals an IP
address to it.

## Declare a font

A font declaration names the file that carries the font:

```ts
// src/fonts.ts
import { defineFonts, font } from "@demiurgejs/core";

export const fonts = defineFonts([
  font.local({
    name: "Inter",
    src: "fonts/inter-latin.woff2",
    weight: "100 900",
  }),
]);
```

`src` names a project file. The file does not belong in the public directory,
because nothing should serve it under a second URL.

Pass the same declaration to the configuration file. The development server
then serves the font URLs that the application renders:

```ts
// demiurge.config.ts
import { defineConfig } from "@demiurgejs/core/config";
import { fonts } from "./src/fonts";

export default defineConfig({
  assets: { fonts },
  routing: { typedRoutes: true },
});
```

## Link the font from the document

`fontLinks` returns the document contribution. Declare it once in the root
layout:

```tsx
// src/routes/@layout.tsx
import { defineLinks, fontLinks } from "@demiurgejs/core";
import { fonts } from "../fonts";

export const links = defineLinks(fontLinks(fonts));
```

The contribution holds a stylesheet link and one preload link for each font.
Every preload carries `crossorigin`, because a browser fetches a font in CORS
mode even on the same origin. A preload without that attribute downloads the
file twice.

The stylesheet is a real file rather than an inline `style` element. A document
therefore keeps `style-src 'self'` and needs no hash and no nonce for its
`@font-face` rules.

## What the build publishes

`demiurge build` writes one file for each declared font, plus the stylesheet:

```text
dist/_demiurge/font/inter-100-900-normal.woff2
dist/_demiurge/font/fonts.css
```

The file name derives from the family, the weight, and the style. The renderer
and the build both compute it from the declaration. No state has to cross the
boundary between the application bundle and the build.

Two declarations that resolve to the same file name stop the build. Give one of
them a different weight or style.

A font URL names the declaration rather than the content of the file. The build
output therefore uses `public, max-age=0, must-revalidate`, the same policy
that an image variant uses.

## Serve a font from a Node server

A Node deployment mounts the handler in front of the static file handler:

```js
import {
  createFontAssetHandler,
  createNodeServer,
  createStaticFileHandler,
} from "@demiurgejs/core/node";
import { fonts } from "./dist/server/server-entry.js";

const serveFont = createFontAssetHandler({ fonts, root: process.cwd() });
const serveFile = createStaticFileHandler({ root: "dist/client" });

createNodeServer({
  allowedHosts: ["localhost"],
  handler,
  static: async (request) => (await serveFont(request)) ?? serveFile(request),
});
```

The handler reads each font once and answers from memory. Every response
carries a strong entity tag, so a repeat request costs one `304`. A path that
names no declared font returns null and falls through to the next handler.

## Self-host a Google font

`font.google` needs the font file URL that the Google stylesheet points at.
Open the stylesheet URL in a browser and copy the `src` of the face you want:

```ts
export const fonts = defineFonts([
  font.google({
    family: "Inter",
    src: "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",
    weight: "100 900",
  }),
]);
```

The framework reads no third-party stylesheet on its own, because that request
is one of the two requests self-hosting removes.

The build downloads the file once and keeps it under
`node_modules/.demiurge/fonts`. A later build reads the cached copy and makes
no network request, so a build without network access keeps working. Commit the
file and declare it with `font.local` when the first build must run offline as
well.

`selfHost: false` keeps the font on its original host. The framework then
writes that URL into the stylesheet and into the preload, and the policy has to
name the host.

## Declare the policy

`fontSources` turns the font declaration into a `font-src` value:

```ts
// src/routes/@policy.ts
import { fontSources, security } from "@demiurgejs/core";
import { fonts } from "../fonts";

export const policy = {
  document: security.static({
    csp: {
      fontSrc: fontSources(fonts),
    },
  }),
};
```

A self-hosted set returns `['self']` alone, which every framework preset
already declares. A font that keeps a third-party host adds that origin, so the
policy shows the cost of the choice in one line.

## Why no font component exists

`Image` exists because an image is an element, and because each render picks a
width, a format, and a quality.

A font is not an element. One declaration governs the whole document, and the
document carries it through `links` and one stylesheet. A component would add a
second place to declare the same thing.

## Examples

- `examples/static-export` publishes Inter from the build output under
  `dist/_demiurge/font`.
- `examples/node-server` serves the same font through
  `createFontAssetHandler` in `server.js`.
