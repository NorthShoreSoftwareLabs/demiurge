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
| `robots.txt.ts` | `/robots.txt` |

Parenthesized route groups organize files without adding a URL segment. Dynamic
segments use `[name]`. A terminal catchall uses `[...name]`. Ambiguous route
shapes and non-terminal catchalls fail manifest generation.

## Method exports

A route exports standard HTTP methods. Helpers describe the result:

```tsx
import { json, page } from "@demiurgejs/core";

export const GET = page({
  view: () => <main>Widget</main>,
});

export const POST = json(({ request }) => ({
  accepted: request.method === "POST",
}));
```

The browser router only treats a page-compatible `GET` as a navigation target.
Other capabilities run through the server request pipeline.

A static build emits fixed `text(...)`, `html(...)`, and `json(...)` GET values.
It keeps a dotted route filename in the output filename.

A static build rejects request-dependent values and request-time methods. The
diagnostic identifies the route file and the unsupported capability.

Implemented response helpers are:

- `page(...)` for React documents
- `json(...)`, `text(...)`, and `html(...)`
- `redirect(...)` and `notFound(...)`
- `response(...)` for an application-owned Web `Response`
- `stream(...)`, `sse(...)`, and `jsonl(...)` for streamed HTTP bodies
- `action(...)` for parsed, optionally idempotent mutations
- `webhook(...)` for verified HMAC webhook requests

### Action validation

An action parser can use any application-owned parser or schema library. The
parser returns the typed input that the handler receives as `context.input`.

When input is invalid, the parser throws an application-created validation
error. The response has status `400` and this stable JSON shape:

```ts
{
  type: "validation-error",
  issues: [{ code: "required", message: "Title is required", path: ["title"] }]
}
```

An empty `path` reports a form-level error. A non-empty path reports a field or
nested value. The framework does not select a parser or expose parser-specific
diagnostics.

Each response helper accepts the response and route-policy options appropriate
to its result. `serverTiming(...)` creates metrics for the `Server-Timing`
header. `throw httpError(status, details)` creates an intentional HTTP failure
that becomes a problem response for APIs or an app-owned error document for
pages.

### Action forms

Use `Form` for client action submissions. The browser router intercepts only
same-origin forms with a supported method and target. Other forms keep native
browser behavior.

The router sends `X-Demiurge-Action: data;v=1` and accepts
`application/vnd.demiurge.action+json;v=1`. A typed result has `version: 1` and
one status: `success`, `invalid`, `redirect`, or `failed`.

```tsx
import { Form, useFormNavigation } from "@demiurgejs/core";

export function SaveForm() {
  const navigation = useFormNavigation();
  return (
    <Form action="/profile" method="post">
      <button disabled={navigation.state === "submitting"}>Save</button>
    </Form>
  );
}
```

`useFormNavigation` reads the nearest `Form` state. `useNavigation` accepts a
form or `submissionKey` for another scope. The router preserves submitter
values and submitter overrides for action, method, target, and encoding. The
router sends URL-encoded, multipart, or plain-text bodies that match the form.
Route revalidation uses the typed `revalidate` result. Cache-tag invalidation
remains a separate server action concern.

## Page routes

`page(...)` accepts a view and optional server data:

```tsx
import { page } from "@demiurgejs/core";

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

Server route values and data functions receive the Web `Request`, decoded path
variables, URL search state, and one mutable request context. Middleware can add
typed values to that context for later middleware, handlers, and page data.

```ts
import { defineMiddleware, json } from "@demiurgejs/core";

type AuthContext = { user: { id: string } };

export const middleware = defineMiddleware<AuthContext>(
  ({ context }, next) => {
    context.user = { id: "user-1" };
    return next();
  },
);

export const GET = json<{ id: string }, "/account">(
  ({ context }) => ({ id: context.user.id }),
);
```

The framework creates the carrier for each request. Middleware runs in
root-to-leaf order. A short-circuit response still stops later middleware and
the route handler.

The generated route declarations intersect the contribution types from each
ancestor `@middleware.ts` file. A route helper needs its path only.

The framework does not pass request context to browser route props or
navigation data. Keep context values server-only. Dynamic values are called
`path`, not `params`:

During browser navigation, the server also resolves document contributions.
The navigation response contains only the resolved title, metadata, links, and
managed script fields. The browser does not run contribution functions.

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
import { href, Link } from "@demiurgejs/core";

href({ to: "/blog/[slug]", path: { slug: "hello" } });

<Link to="/blog/[slug]" path={{ slug: "hello" }}>
  Read the post
</Link>
```

Generated route declarations live under the application's `.demiurge`
directory and should not be edited by hand.

`Link` accepts native anchor attributes except `href`. Use `to`, `path`,
`search`, and `hash` to create the `href` value.

The router intercepts an unmodified primary click on a same-origin HTTP link.
The router does not intercept these links:

- A link with `reloadDocument`.
- A link with `download`.
- A link with a target other than `_self`.
- A link to a different origin.
- A link that uses a non-HTTP scheme.

## Accessible browser navigation

Browser navigation preserves focus by default. The framework announces the
resolved document title after each ready, not-found, or error commit.

Applications can opt in to route focus with an app-owned boundary:

```tsx
import { RouteFocusBoundary } from "@demiurgejs/core";

export function Layout({ children }: { children: React.ReactNode }) {
  return <RouteFocusBoundary as="main">{children}</RouteFocusBoundary>;
}
```

The boundary uses `tabIndex={-1}` and accepts an application ref. The first
mounted boundary is active. A hash-only navigation uses the browser fragment
target and does not announce or focus the route boundary.

Set `navigationAccessibility.announce` to `false`, `"title"`, or a function
that returns a complete message. The function receives the destination URL,
navigation kind, outcome, and resolved title. A null or empty result skips the
announcement.

An application `onClick` handler runs before the router. If the handler
prevents the default action, the router does not navigate.

Use `LinkProps` to preserve typed destinations in an application wrapper:

```tsx
import { Link, type AppHref, type LinkProps } from "@demiurgejs/core";

type NavLinkProps<TTo extends AppHref> = LinkProps<TTo> & {
  emphasis?: "normal" | "strong";
};

function NavLink<const TTo extends AppHref>({
  emphasis = "normal",
  ...props
}: NavLinkProps<TTo>) {
  return <Link data-emphasis={emphasis} {...props} />;
}
```

## Negotiation and failures

Unmatched browser requests that explicitly accept HTML receive the app-owned
not-found document. API-style callers receive `application/problem+json`.
Intentional `httpError(...)` failures preserve their status and public details.
Unexpected production errors are redacted. See
[Errors and not-found](../guides/errors-and-not-found.md).
