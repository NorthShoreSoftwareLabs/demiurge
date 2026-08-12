# Routes

A route file owns an address. Its HTTP method exports declare what the address
can produce: a page, structured response, redirect, or stream.

## File mapping

Files under `src/routes` map to URLs:

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `blog/index.tsx` | `/blog` |
| `blog/[slug].tsx` | `/blog/:slug` |
| `docs/[...path].tsx` | `/docs/*` |
| `(marketing)/about.tsx` | `/about` |

Parenthesized route groups organize files without adding a URL segment. Dynamic
segments use `[name]`; a terminal catchall uses `[...name]`. Ambiguous route
shapes and non-terminal catchalls fail manifest generation.

## Method exports

A route exports standard HTTP methods. Helpers describe the result:

```tsx
import { json, page } from "@demiurge-js/core";

export const GET = page({
  view: () => <main>Widget</main>,
});

export const POST = json(({ request }) => ({
  accepted: request.method === "POST",
}));
```

The browser router only treats a page-compatible `GET` as a navigation target.
Other capabilities run through the server request pipeline.

Implemented response helpers are:

- `page(...)` for React documents
- `json(...)`, `text(...)`, and `html(...)`
- `redirect(...)` and `notFound(...)`
- `response(...)` for an application-owned Web `Response`
- `stream(...)`, `sse(...)`, and `jsonl(...)` for streamed HTTP bodies
- `action(...)` for parsed, optionally idempotent mutations
- `webhook(...)` for verified HMAC webhook requests

Each response helper accepts the response and route-policy options appropriate
to its result. `serverTiming(...)` creates metrics for the `Server-Timing`
header. `throw httpError(status, details)` creates an intentional HTTP failure
that becomes a problem response for APIs or an app-owned error document for
pages.

## Page routes

`page(...)` accepts a view and optional server data:

```tsx
import { page } from "@demiurge-js/core";

export const GET = page({
  data: async ({ cache, path }) =>
    cache.get({
      fn: () => loadPost(path.slug),
      key: ["post", path.slug],
      ttl: "5m",
    }),
  view: ({ data }) => <article>{data.title}</article>,
});
```

Route data runs on the server. Browser navigation requests a typed server-data
envelope instead of rerunning the function in the browser.

Dynamic routes may export `paths` for static generation:

```tsx
export const paths = () => [
  { slug: "hello" },
  { slug: "release-notes" },
];
```

## Attached files

Names beginning with `@` attach behavior to a route subtree rather than owning
their own URL:

| File | Role |
| --- | --- |
| `@layout.tsx` | Wraps page-compatible routes below it |
| `@loading.tsx` | Suspense fallback for its subtree |
| `@not-found.tsx` | App-owned not-found document |
| `@error.tsx` | App-owned error document |
| `@middleware.ts` | HTTP middleware cascade |
| `@policy.ts` | Security-policy cascade |

Layouts, middleware, and policy apply root-to-leaf. An ordinary file such as
`policy.tsx` remains the real `/policy` route.

Page applications must provide a root `@not-found.tsx`. Production builds fail
without it so missing URLs never fall through to framework-branded markup.

## Route context

Route handlers receive the Web `Request`, decoded path variables, URL search
state, and framework services appropriate to the capability. Dynamic values are
called `path`, not `params`:

```tsx
export const GET = json(({ path, request }) => ({
  id: path.id,
  method: request.method,
}));
```

Malformed encoded paths are rejected consistently across browser, server, and
static modes.

## Typed URLs

Enable `typedRoutes` in the Vite plugin to generate the route manifest types:

```ts
demiurge({ typedRoutes: true })
```

`href(...)`, `redirect(...)`, and `<Link />` then reject unknown route patterns
and require the variables declared by dynamic routes:

```tsx
import { href, Link } from "@demiurge-js/core";

href({ to: "/blog/[slug]", path: { slug: "hello" } });

<Link to="/blog/[slug]" path={{ slug: "hello" }}>
  Read the post
</Link>
```

Generated route declarations live under the application's `.demiurge`
directory and should not be edited by hand.

## Negotiation and failures

Unmatched browser requests that explicitly accept HTML receive the app-owned
not-found document. API-style callers receive `application/problem+json`.
Intentional `httpError(...)` failures preserve their status and public details;
unexpected production errors are redacted. See
[Errors and not-found](../guides/errors-and-not-found.md).
