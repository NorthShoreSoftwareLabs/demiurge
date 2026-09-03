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
- `mutation(...)` for parsed, optionally idempotent mutations
- `webhook(...)` for verified HMAC webhook requests

### Mutation validation

A mutation can validate form input with a Standard Schema library. The schema
provides runtime validation and the handler input type.

```ts
const publishInput = z.object({
  title: z.preprocess(
    (value) => typeof value === "string" ? value : "",
    z.string().trim().min(1, "Enter a title."),
  ),
});

export const POST = mutation({
  input: mutationInput.form(publishInput, (form) => ({
    title: form.get("title"),
  })),
  handler: ({ input }) => json({ title: input.title }),
});
```

The mapping function defines how form fields become schema input. The schema
can transform that input before the handler receives it.

`mutationInput.form` accepts all Standard Schema implementations. The core
package does not require a specific schema library.

Use `mutationInput.custom` for application-owned validation. The type parameter
limits the first path segment to an application field name:

```ts
const input = mutationInput.custom<"title" | "body", FormData>(
  async (context) => {
    const form = await mutationInput.formData(context);
    if (!form.has("title")) {
      throw new MutationValidationError<"title" | "body">({
        issues: [{
          code: "required",
          message: "The title is required.",
          path: ["title"],
        }],
      });
    }
    return form;
  },
);
```

A native request receives status `400` and this stable JSON shape:

```ts
{
  type: "validation-error",
  issues: [{ code: "required", message: "Title is required", path: ["title"] }]
}
```

An enhanced request receives the same issues in an `invalid` mutation result:

```ts
{
  version: 1,
  status: "invalid",
  validation: {
    issues: [{ code: "required", message: "Title is required", path: ["title"] }],
  },
}
```

An empty `path` reports a form error. A non-empty path reports a field or nested
value. Schema issues use the stable `invalid` code. Demiurge does not expose
schema-library diagnostics.

Mutation data must contain JSON values. Demiurge accepts null values, booleans,
finite numbers, strings, arrays, and plain objects with string keys.

Demiurge rejects unsupported data before it writes a structured result. This
rule rejects cycles, undefined values, non-finite numbers, and class instances.

An unexpected exception uses the application error boundary and production
redaction rules. A raw application `Response` keeps its original body, status,
and headers. A React Action requires a structured mutation result instead.

Each response helper accepts the response and route-policy options appropriate
to its result. `serverTiming(...)` creates metrics for the `Server-Timing`
header. `throw httpError(status, details)` creates an intentional HTTP failure
that becomes a problem response for APIs or an app-owned error document for
pages.

### Mutation forms

Use `useMutationAction(...)` with `Form` for a typed progressive mutation. The
server-rendered form contains a real HTTP URL and the `post` method.

After hydration, React submits the same `FormData` through the typed mutation
client. React owns the pending state through `useFormStatus`.

The router sends `X-Demiurge-Mutation: data;v=1` and accepts
`application/vnd.demiurge.mutation+json;v=1`. A typed result has `version: 1` and
one status: `success`, `invalid`, `redirect`, or `failed`.

The `success` result can contain application data. The `invalid` result contains
typed validation issues. The `failed` result does not contain application data.

The mutation helper gives each redirect an explicit history operation. It uses
`replace` for `301` and `308`. It uses `push` for `302`, `303`, and `307`.

```tsx
import {
  Form,
  MutationSubmit,
  useMutationAction,
} from "@demiurgejs/core";
import { useFormStatus } from "react-dom";

export function SaveForm() {
  const [result, save] = useMutationAction(
    { route: "/profile", method: "POST" },
    undefined,
  );
  const [, publish] = useMutationAction(
    { route: "/profile/publish", method: "POST" },
    undefined,
  );

  return (
    <Form action={save}>
      <input name="displayName" />
      <PendingButton />
      <MutationSubmit formAction={publish} name="intent" value="publish">
        Publish
      </MutationSubmit>
      {result?.status === "invalid"
        ? result.validation.issues.map((issue) => (
            <p key={`${issue.code}:${issue.path.join(".")}`}>{issue.message}</p>
          ))
        : null}
    </Form>
  );
}

function PendingButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Saving" : "Save"}</button>;
}
```

`MutationSubmit` preserves a real `formAction` URL before hydration. After
hydration, it uses the selected React Action. The submitted data includes the
submitter name and value.

Typed progressive forms support `POST`. Native HTML forms cannot submit `PUT`,
`PATCH`, or `DELETE`. Use `createMutationAction(...)` for a client-only call to
one of these methods.

The client preserves multipart values and files. It does not set the multipart
content type because the browser must add the boundary.

Set `revalidateRoute` to `true` on `mutation(...)` to refresh the current route
after success. Use `revalidate` to invalidate declared cache keys and tags. The
operations are separate.

The server controls route refresh. A client cannot add or change the
`revalidateRoute` declaration.

A refresh retrieves the current pathname and search from the server. It keeps
the current URL, history, scroll position, and focus.

React Action pending state remains active until the requested refresh settles.
If the refresh fails, the router renders the resolved route error boundary.
The mutation can remain successful because its server commit already finished.

An `invalid` or `failed` result does not refresh the route. A redirect takes
precedence over refresh. The router does not refresh the previous route before
it follows the redirect.

Cache invalidation and route refresh have different purposes. The `revalidate`
option changes cached server authority. The `revalidateRoute` option retrieves
the current authority for the browser.

The server resolves `revalidate` only after a successful handler result. It
completes invalidation before it returns a success or redirect response.

Validation, failed, and not-found results do not invalidate cached data. An
idempotent replay does not repeat the original invalidation.

If invalidation fails, the route uses the normal error and redaction path. The
application change can already be committed, and Demiurge cannot roll it back.

The browser cannot supply keys or tags. Only the server route owns the
declaration.

#### React Action state

`useMutationAction` uses React `useActionState`. React owns component result,
pending, and optimistic state. Demiurge owns transport, result validation,
redirects, cancellation, and route refresh.

`Form` also accepts a string `action` for compatibility. This form uses the
browser router and exposes state through `useFormNavigation` and
`useNavigation`.

#### CSRF tokens in progressive forms

Cookie-authenticated mutations use CSRF protection by default. The default
policy accepts a matching token in the configured request header.

If a form must work without JavaScript, configure a field on the route policy:

```tsx
export const policy = defineRoutePolicy({
  security: { csrf: { field: "_csrf" } },
});
```

Issue a token on the server. Then, include the same token in the form:

```tsx
<Form action={save}>
  <input type="hidden" name="_csrf" value={token} />
  <input name="title" />
  <button type="submit">Save</button>
</Form>
```

The configured field or header must match the CSRF cookie. Do not put a
session token or another credential in the field.

#### Mutation conformance limits

Request cancellation is advisory. An aborted request can complete its server
commit after the browser stops waiting for the result.

A process can stop after a commit and before cache invalidation completes.
Demiurge cannot roll back the application commit.

A memory cache applies to one process. Use a shared cache store when all
application instances must observe one invalidation.

React owns optimistic state and conflict policy. Application tests must cover
rollback, overlapping edits, and authoritative refresh for each optimistic UI.

The framework tests simulate transport cancellation and stale browser results.
They do not simulate a process failure during a commit or a network partition
between application instances.

### Migration from action names

Version 0.2.0 removes the earlier nightly action names. It does not provide
deprecated aliases. Apply these direct replacements:

| Old name | New name |
| --- | --- |
| `action` | `mutation` |
| `actionInput` | `mutationInput` |
| `ActionContext` | `MutationContext` |
| `ActionIdempotency` | `MutationIdempotency` |
| `ActionInput` | `MutationInput` |
| `ActionOptions` | `MutationOptions` |
| `ActionRevalidation` | `MutationRevalidation` |
| `ActionValidationError` | `MutationValidationError` |
| `ActionValidationIssue` | `MutationValidationIssue` |
| `ActionResult` | `MutationResult` |
| `ActionNavigationState` | `MutationNavigationState` |

HTML `action` and `formAction` properties keep their platform names. React API
names such as `useActionState` also keep their names.

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

Enable `typedRoutes` in `demiurge.config.ts` to generate the route manifest
types:

```ts
defineConfig({ routing: { typedRoutes: true } })
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

The generated declarations also identify each route mutation method. Use
`createMutationAction(...)` to create a client function for React
`useActionState`:

```tsx
import { createMutationAction } from "@demiurgejs/core";
import { useActionState } from "react";

const savePost = createMutationAction<{ title: string }>({
  route: "/blog/[slug]",
  method: "PATCH",
  path: { slug: "hello" },
});

export function EditPost() {
  const [result, save, pending] = useActionState(savePost, undefined);

  return (
    <form action={save}>
      <input name="title" />
      <button disabled={pending}>Save</button>
      {result?.status === "failed" ? <p>{result.message}</p> : null}
      {result?.status === "invalid"
        ? result.validation.issues.map((issue) => (
            <p key={`${issue.code}:${issue.path.join(".")}`}>{issue.message}</p>
          ))
        : null}
    </form>
  );
}
```

The route must export `mutation(...)` under the selected unsafe HTTP method.
Generated types reject an unknown route, an unavailable method, or missing path
values.

Each client function owns one current submission. A new call cancels the old
request when possible. An obsolete response cannot replace the new result.

The function submits `FormData` through the HTTP route. It sends same-origin
credentials and the mutation protocol headers. The browser does not import the
server mutation handler.

Demiurge writes the generated declarations to
`.demiurge/route-manifest.d.ts`. Add that file to the `include` array in
`tsconfig.json`. A TypeScript directory entry or broad glob does not enter a
directory that starts with a dot. Do not edit the generated file.

To select another path, give `typedRoutes` an `outputFile` value:

```ts
defineConfig({
  routing: { typedRoutes: { outputFile: "types/routes.d.ts" } },
})
```

The application must then make its own `tsconfig.json` include that path.

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

## Browser scroll restoration

The server navigation router controls the scroll position after it commits a
route. A new path scrolls to the top of the document. This applies to ready,
not-found, and error content. The router waits for the final content before it
changes the scroll position.

The router saves each entry position in its history state. Back and forward
navigation restores the saved position. The router preserves other values in
the history state. It uses manual restoration while the router is mounted.

The router applies a URL fragment after it commits the route. A matching
fragment target receives normal browser fragment behavior. A missing target
does not change the scroll position. A hash-only navigation does not load a
route or apply the top position.

Set `replace` on a `Link` when the destination must replace the current history
entry. The router applies the same scroll rules to push and replace.

Applications can disable or replace the default behavior:

```tsx
createFileRouter({
  navigationScroll: false,
  routes,
});

createFileRouter({
  navigationScroll: ({ navigation, outcome, position }) => {
    if (navigation === "pop" && position) {
      window.scrollTo(position.x, position.y);
    }
  },
  routes,
});
```

The callback runs after a committed ready, not-found, or error route. It does
not run for initial hydration, hash-only navigation, or cancelled navigation.
The router catches callback errors so they cannot break route rendering.

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
