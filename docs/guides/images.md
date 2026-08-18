# Images

Demiurge optimizes an image in two shapes. A static build emits one file for
each variant. A runtime adapter transforms each variant on request.

Both shapes use the same policy, the same planner, and the same `Image`
component. The image policy selects the shape.

## Install the codec

Image optimization uses `sharp`. It is an optional peer dependency. Install it
in the application that optimizes an image:

```sh
pnpm add sharp
```

An application that never renders an `Image` does not need `sharp`.

## Declare an image policy

An image policy states which sources the framework accepts. Local absolute
paths are allowed by default. A remote source requires an explicit entry:

```ts
// src/images.ts
import { defineImages } from "@demiurgejs/core";

export const images = defineImages({
  loader: "static",
  remote: ["https://images.example.com"],
});
```

Pass the same policy to the Vite plugin. The development server then serves
the image URLs that the application renders:

```ts
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";
import { images } from "./src/images";

export default defineConfig({
  plugins: [demiurge({ images, typedRoutes: true })],
});
```

## Render an image

`Image` plans the variants and renders one `img` element:

```tsx
import { Image } from "@demiurgejs/core";
import { images } from "../images";

export function Hero() {
  return (
    <Image
      alt="A layered mountain skyline at dusk"
      format="webp"
      height={300}
      policy={images}
      priority
      quality={72}
      sizes="(min-width: 720px) 600px, 100vw"
      src="/hero.png"
      width={600}
      widths={[600, 1200]}
    />
  );
}
```

The component writes `decoding`, `loading`, `sizes`, `src`, `srcSet`, and the
intrinsic `width` and `height`. `priority` makes the image eager and gives it a
high fetch priority. Without `widths`, the planner uses the declared width and
twice that width.

`planImageTransform` returns the same plan as a value. Use it when the
application renders its own element, such as a `picture` element.

## The static loader

`loader: "static"` is the shape for a static export. Each variant path
describes its own transform:

```text
/_demiurge/image/hero.png.w600.q72.webp
```

The path names the source file, the width, the quality, and the output format.
`demiurge build` reads these paths back out of the documents it rendered, then
writes one file for each variant into the build output. Any static host serves
those files. No rewrite rule and no application server is required.

The static loader has three rules:

- The source must be a local path that the build output already contains, such
  as a file in the Vite public directory.
- A remote source is rejected. Copy the image into the public directory.
- A variant that no rendered document references is not emitted.

`demiurge build` stops when a document points at the request-time optimizer.
Set `loader: "static"`, or deploy a runtime adapter.

## The runtime optimizer

The default `loader: "optimizer"` writes a query URL:

```text
/_demiurge/image?src=%2Fhero.png&w=600&q=72
```

The Node adapter serves that path. Compose the optimizer with the static file
handler:

```js
import {
  createImageOptimizer,
  createNodeServer,
  createStaticFileHandler,
} from "@demiurgejs/core/node";
import { images } from "./src/images.js";

const root = "dist/client";
const optimizeImage = createImageOptimizer({ policy: images, root });
const serveFile = createStaticFileHandler({ root });

createNodeServer({
  allowedHosts: ["localhost"],
  handler,
  static: async (request) =>
    (await optimizeImage(request)) ?? serveFile(request),
});
```

The optimizer repeats the policy check on every request, because a client
writes the query itself. It answers `400` for an invalid parameter, `403` for a
source the policy does not allow, and `404` for a source it cannot read.

The optimizer keeps the most recent encoded variants in memory. Set
`cacheSize` to change how many. Each response carries a strong entity tag, so a
repeat request costs one `304`.

Without an explicit `format`, the optimizer reads the `accept` header and
selects AVIF, then WebP, then the source format. Such a response carries
`vary: accept`.

The optimizer fetches an allowed remote source and rejects a response larger
than 20 MB.

## Choose a loader

Use the static loader for a static export, and for a host that serves files
only. Use the runtime optimizer when the application already runs a Node
server, or when it optimizes a remote image.

A delegated platform optimizer is a third shape. Point `optimizerPath` at the
path that the platform serves, and do not mount `createImageOptimizer`. The
framework then writes the URL and the platform owns the transform.

## Cache behavior

A variant path is not content-addressed. It names the source file, so a
replaced source keeps its URL. Both shapes therefore use
`public, max-age=0, must-revalidate`, and the runtime optimizer adds an entity
tag. Give a new image a new file name when a long cache lifetime matters.

## Examples

- `examples/static-export` uses the static loader. `demiurge build` writes the
  variants under `dist/_demiurge/image`.
- `examples/node-server` uses the runtime optimizer in `server.js`.
