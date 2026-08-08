# Route Capabilities

## Mental Model

Top-level route exports answer:

> How can the runtime enter this route?

Helpers answer:

> What does this handler produce?

That gives us this public shape:

```ts
export const GET = page(...)
export const POST = json(...)
export const WS = socket(...)
```

MVP `0.0.1` implements `page(...)` plus the first HTTP response helpers:

```ts
json(...)
text(...)
html(...)
redirect(...)
notFound(...)
response(...)
```

The browser router only renders page-compatible `GET` routes. Non-page `GET`
routes are valid route capabilities, but they are not browser navigation
targets until the HTTP runtime exists.

The first HTTP request handler is implemented through `createRequestHandler(...)`:

```ts
const handler = createRequestHandler({
  routes: import.meta.glob<RouteModule>("./routes/**/*.tsx"),
});
```

It can resolve non-page route capabilities to platform `Response` objects. Page
routes currently return `501` through this handler until SSR/RSC renderers are
implemented.

The Vite plugin wires this into development:

```ts
import { demiurge } from "demiurge/vite";

export default defineConfig({
  plugins: [demiurge(), react()],
});
```

In development, non-page route capabilities are served as HTTP responses. Page
routes fall through to Vite so the browser app can handle client navigation.

## Generated Typed URLs

Demiurge generates route types from the `routes` folder into a framework-owned
hidden directory at `.demiurge/`. App code still writes actual URLs and file
route patterns:

```tsx
<Link to="/blog">Blog</Link>
<Link to="/blog/[slug]" path={{ slug: "file-based-routing" }}>Read</Link>
<Link to="/blog/file-based-routing">Read</Link>
```

The hidden generated route type file augments the framework package:

```ts
declare module "demiurge" {
  interface RoutePathVars {
    "/blog/[slug]": { slug: PathValue };
  }

  interface RouteConcretePaths {
    "/blog/[slug]": `/blog/${PathValue}`;
  }
}
```

This means unknown URLs fail typecheck, dynamic patterns require their `path`
values, and concrete dynamic URLs can still autocomplete as real strings.

Route components and handlers can opt into the same generated route map with a
route-pattern generic:

```tsx
import { page, type RouteProps } from "demiurge";

export const GET = page({
  view: BlogPost,
});

function BlogPost({ path }: RouteProps<"/blog/[slug]">) {
  return <h1>{path.slug}</h1>;
}
```

The Vite plugin can generate this file on startup and watch route files during
development:

```ts
demiurge({ typedRoutes: true })
```

## Framework-Attached Files

Only filenames beginning with `@` are reserved for framework behavior:

```txt
@layout.tsx
@policy.ts
@middleware.ts
@error.tsx
@loading.tsx
@not-found.tsx
```

Everything else belongs to the app's URL space:

```txt
policy.ts      -> /policy
middleware.ts  -> /middleware
layout.ts      -> /layout
```

This lets apps expose real endpoints such as `/policy` without colliding with
inherited framework configuration.

Framework-attached UI files should define app-owned UI. The framework should not
emit opinionated markup, CSS classes, copy, or document structure for loading,
not-found, or error states. MVP `0.0.1` supports app-provided browser fallbacks
through `createFileRouter`; future runtime work should move this into inherited
`@loading.tsx`, `@not-found.tsx`, and `@error.tsx` files.

## Nested Layouts

`@layout.tsx` attaches to a folder and wraps every page-compatible handler below
that folder.

```txt
routes/
  @layout.tsx
  index.ts

  blog/
    @layout.tsx
    index.ts
    [slug].ts
```

The render chain for `/blog/hello` is:

```txt
routes/@layout.tsx
  -> routes/blog/@layout.tsx
    -> routes/blog/[slug].ts
```

Layouts receive `children` plus the route context:

```ts
type LayoutProps = {
  children: React.ReactNode;
  path: PathVars;
  search: URLSearchParams;
  pathname: string;
  request: Request;
  security: SecurityContext;
};
```

Route groups can organize inheritance without affecting the URL:

```txt
routes/
  (marketing)/
    @layout.tsx
    pricing.ts

  (app)/
    @layout.tsx
    dashboard.ts
```

`routes/(app)/dashboard.ts` maps to `/dashboard`.
Generated route types and runtime matching both omit route group segments.

Layout inheritance should have an escape hatch for embedded or standalone
documents:

```ts
export const GET = page({
  layout: false,
  render: () => <EmbeddableWidget />,
});
```

We should start with this simple boolean before adding more precise layout
selection.

## Path Variables, Not Params

Avoid using `params` as the main public word for dynamic path values. It is
common router vocabulary, but it collides mentally with URL search/query
parameters.

Preferred terminology:

- `path`: variables extracted from dynamic path segments.
- `search`: URL search parameters from `?page=2`.
- `hash`: URL fragment, mostly browser-side.

For:

```txt
routes/blog/[slug].ts
```

use:

```ts
export const GET = page({
  view: ({ path }) => <Post slug={path.slug} />,
});
```

instead of:

```ts
export const GET = page({
  view: ({ params }) => <Post slug={params.slug} />,
});
```

This makes route context read closer to the platform:

```ts
ctx.path.slug;
ctx.search.get("page");
ctx.url.hash;
```

## Policy, Middleware, And Layout Cascade

For a matched route, the framework collects inherited behavior root-to-leaf:

```txt
policies:    root -> leaf
middleware:  root -> leaf
layouts:     root -> leaf
handler:     matched route capability
```

The request pipeline is:

```txt
1. match route
2. merge policies
3. run middleware root -> leaf
4. run handler
5. if handler returns page/react, wrap with layouts root -> leaf
6. render response with final security policy
```

Policies are declarative and inheritable. Middleware is imperative and
composable. Layouts are UI composition. Route handlers are capabilities.

## Entry Capabilities

### HTTP

These should be the first supported entrypoints:

```ts
export const GET = ...
export const POST = ...
export const PUT = ...
export const PATCH = ...
export const DELETE = ...
export const OPTIONS = ...
export const HEAD = ...
```

Potential later support:

```ts
export const CONNECT = ...
export const TRACE = ...
```

`CONNECT` is useful for proxies and tunnels, but probably should not be a core
application primitive at the beginning. `TRACE` is generally not desirable for
application frameworks.

### WebSocket

WebSocket deserves a top-level capability because it starts as an HTTP upgrade
and then becomes a bidirectional message channel.

```ts
export const WS = socket({
  open(peer) {},
  message(peer, message) {},
  close(peer) {},
});
```

### WebTransport

WebTransport is a future-facing capability built on HTTP/3. It supports
bidirectional streams, unidirectional streams, and unreliable datagrams.

```ts
export const WEBTRANSPORT = transport({
  stream(session, stream) {},
  datagram(session, bytes) {},
});
```

This should come later because runtime and deployment support are more
specialized than plain HTTP or WebSocket.

### WebRTC

WebRTC itself should probably not start as a route capability. The framework
normally handles signaling, while browsers establish peer-to-peer media or data
connections.

Signaling can be expressed with existing capabilities:

```ts
export const POST = json(handleRtcOffer)
export const GET = sse(sendRtcCandidates)
export const WS = socket(rtcSignalingSocket)
```

We can add an `rtcSignaling(...)` helper later if the pattern becomes common.

## HTTP Result Helpers

Initial helpers:

```ts
page(...)
json(...)
text(...)
html(...)
redirect(...)
notFound(...)
empty(...)
status(...)
file(...)
download(...)
stream(...)
sse(...)
jsonl(...)
```

Implemented in MVP `0.0.1`:

```ts
page(...)
json(...)
text(...)
html(...)
redirect(...)
notFound(...)
response(...)
```

Still designed/planned:

```ts
react(...)
empty(...)
status(...)
file(...)
download(...)
stream(...)
sse(...)
jsonl(...)
```

`stream(...)`, `sse(...)`, `jsonl(...)`, streamed SSR, and streamed RSC are all
HTTP results. They should not be top-level route capabilities.

## Streaming Taxonomy

Streaming can mean several different things:

- Generic HTTP body streaming with `ReadableStream`.
- Server-Sent Events over a long-lived HTTP `GET`.
- JSON Lines or newline-delimited data over HTTP.
- File download streaming over HTTP.
- React SSR streaming HTML over HTTP.
- React Server Components streaming a Flight payload over HTTP.
- WebSocket bidirectional messages after an HTTP upgrade.
- WebTransport streams and datagrams over HTTP/3.
- WebRTC peer-to-peer media or data after signaling.

This distinction protects the API from collapsing everything into one vague
`stream` primitive.

## Client Navigation Rule

Client-side navigation should only treat a matched `GET` route as navigable when
the result is React-compatible:

```ts
page(...)
react(...)
redirect(...)
notFound(...)
```

Routes returning `json(...)`, `sse(...)`, `file(...)`, or `download(...)` are
still valid routes, but they are not page navigation targets.
