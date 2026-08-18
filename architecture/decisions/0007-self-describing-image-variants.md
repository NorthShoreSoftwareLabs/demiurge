# ADR 0007: Self-Describing Image Variant Paths

## Status

Accepted.

## Context

Issue #66 records that `planImageTransform` produced URLs that no part of the
framework served. The planner wrote `/_demiurge/image?src=...&w=...`, and no
build step and no request handler answered that path.

A static export has no application server. A query URL therefore cannot become
a file without a host rewrite rule, and a rewrite rule that matches a query
string is provider-specific. ADR 0004 already keeps provider-specific output
inside the Vercel adapter, so a second provider-specific rule would spread that
boundary.

The build must also learn which variants an application asked for. The
application renders through the framework, so the build could record each plan
in module state. That fails in practice. The Vite SSR build inlines
`@demiurgejs/core` into the application server bundle. The rendered planner and
the build planner are then different modules with different state.

## Decision

The image policy selects one of two loaders.

`loader: "static"` writes a variant path that describes its own transform:
`/_demiurge/image/hero.png.w600.q72.webp`. The path names the source file, the
width, the optional quality, and the output format.

`demiurge build` reads those paths back out of the documents it rendered, parses
each one, and writes the encoded file into the build output. No state crosses
the boundary between the application bundle and the build process, so the
bundling shape of the application cannot break the pipeline.

The default `loader: "optimizer"` keeps the query URL. `createImageOptimizer`
in the Node adapter serves it, and the Vite development server serves both
loaders. The build stops when a static output document points at the
request-time optimizer.

`sharp` is an optional peer dependency, following ADR 0006. Only an application
that optimizes an image installs it.

## Consequences

A static export runs on any file host. It needs no rewrite rule, so the Vercel
adapter gains no image-specific route.

The build emits only the variants that a rendered document references. A
variant that reaches a client only through a stylesheet or a script is not
emitted. The application must reference such a variant from a document.

A variant path is readable and reversible, which makes the build output easy to
audit. It is not content-addressed, so a replaced source file keeps its URL.
Both loaders therefore use a revalidated cache policy rather than an immutable
one.

A delegated platform optimizer remains available. An application points
`optimizerPath` at the path the platform serves and mounts no handler.
