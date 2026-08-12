# Errors and Not-Found

Every request that fails gets a response the framework designed, in the format
the caller asked for. No blank pages, no HTML sent to an API client, no stack
traces in production.

Implementation history is tracked in [GitHub issue #3](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/3).

## Not-found

### Format is negotiated, not configured

On an unmatched path there is no route to consult, so `accept` is the only
signal. A request with an explicit `text/html` or `application/xhtml+xml` range
gets the not-found document. Everything else gets `application/problem+json`
per RFC 9457, which obsoleted RFC 7807:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "instance": "/api/widgets/9"
}
```

The rule is deliberately strict. A bare `*/*`, a missing header, and a
malformed one all get problem+json, because failing toward the machine format
is the safe direction: a browser always sends an explicit `text/html`, while an
API client that sends `*/*` never receives a page of markup it cannot parse.

Negotiation happens in the request handler rather than an adapter, so every
adapter inherits it.

`notFound()` with no body routes through the same path, so an app cannot ship
two different 404 shapes. An explicit body, status, or header on the capability
still wins.

### The document renders inside inherited layouts

Layouts resolve from the requested pathname, so `/admin/nope` picks up
`/admin/@layout.tsx` when one exists and the root layout otherwise. A 404 keeps
the site's nav, footer, and styles rather than looking like a different
website. Layouts inside a route group are skipped, since a group segment has no
URL to resolve against.

A layout resolved this way may expect a session or run a loader that throws,
and `/admin/nope` is exactly where that happens. Rendering gives up one layer
of app code at a time:

1. The app `@not-found.tsx` inside its inherited layouts.
2. The same component with no layouts.
3. The framework built-in with no layouts.

A blank page is the outcome this whole design exists to prevent, so a broken
layout degrades to the layout-free document instead of escalating to a 500.

Opt out of layouts entirely:

```tsx
// src/routes/@not-found.tsx
export const layout = false;

export default function NotFound({ pathname }: NotFoundProps) {
  return <h1>Nothing at {pathname}</h1>;
}
```

### The build refuses a page app with no root @not-found.tsx

The framework ships a working 404 so nothing is ever blank, and `vite build`
fails until the app has decided on its own. A generic framework page in front
of real users is a failure of the framework, not of the app that never got
around to it.

The gate only fires when the app has at least one page route. An API-only app
never wants an HTML not-found document, builds clean, and gets problem+json for
everything.

Page detection is a source scan, because the plugin cannot execute route
modules at build time. It keys on the import rather than the bare word: a file
counts as a page route only if it imports `page` from `@demiurge-js/core` and calls what
it imported, aliases included. Scanning for `page(` alone would fire on
`db.users.page(2)`, and telling an API that paginates to go write a 404
document is exactly the failure this gate must not have.

Dev serves the built-in and warns once, naming the file to create.

### The client agrees with the server

A server-rendered 404 carries `data-demiurge-fallback="not-found"` on the root
element. The client hydrates that document, keeping the layouts the server
resolved, and still replaces a page document whose route it can no longer match
— that case is a genuine desync rather than a fallback.

## Errors

### Typed HTTP errors keep status explicit

Throw `httpError(...)` when a route, loader, middleware, or policy needs to
return an intentional HTTP failure:

```ts
import { httpError, json } from "@demiurge-js/core";

export const POST = json(async () => {
  throw httpError(422, {
    detail: "slug already taken",
    errors: { slug: ["Choose another slug."] },
    type: "https://example.com/problems/widget-validation",
  });
});
```

The status argument is the `HttpErrorStatus` union of standard 4xx and 5xx
codes. JavaScript callers receive the same runtime validation, so an accidental
`httpError(200, ...)` fails where it is created instead of producing a success
response with an error body.

For an API route, the framework returns RFC 9457 `application/problem+json`.
The request pathname and query become `instance`; `detail`, `type`, a custom
`title`, and extension members such as `errors` are preserved. A string second
argument is shorthand for `detail`. Standard status titles are defaults.

For a page route, the same error renders the app's `@error.tsx` document and
sets its HTTP status. `RouteErrorProps` includes `status`, `pathname`, and the
original `error`. The built-in fallback displays the real status rather than
claiming every failure is 500.

Typed details are deliberate public output and remain visible in production
problem responses. Messages and stacks from arbitrary thrown values remain
redacted exactly as before. The optional third argument carries `headers` and
`cause`; headers support protocol requirements such as `WWW-Authenticate` and
`Retry-After` on both problem responses and error documents.

`httpError(...)` is a throw-only signal. Normal successful and redirecting
responses continue to use `json(...)`, `text(...)`, `redirect(...)`, and the
other response capabilities.

### A failure response is not one thing

Where the failure happened decides what the caller gets.

| Failure site | Response |
| --- | --- |
| Inside a page render | App `@error.tsx` renders a document, typed status or 500 |
| Inside an API route handler | `application/problem+json`, typed status or 500, never HTML |
| Inside middleware or policy | Negotiated, same rule as not-found |
| While rendering the error page | Plain text, no app code |

The last row matters most. Once the error path has failed, the app path cannot
be trusted a second time in the same request, so there is no second attempt at
app markup.

The error document renders without layouts. The error path runs the minimum
amount of app code that can still produce a page.

### Dev shows the stack, production never does

Production keeps the guarantee that no stack trace, file path, or framework
internal reaches a response body. Dev renders its own document with the
message, the stack, and the route that failed, and puts the thrown message in
`detail` on a problem+json response.

That redaction applies to unexpected values. An `HttpError` is the explicit
boundary where an app author chooses public `detail` and extension members, so
those fields are stable in development and production.

The switch is the build mode. The Vite dev middleware sets it when it calls the
shared handler; it is absent from the public `RequestHandlerOptions`, and it is
gated a second time on `NODE_ENV !== "production"`. There is no user-facing
option to misconfigure into leaking.

In dev the framework document wins over the app's `@error.tsx`, because the
stack is the point. Production renders the app's.

### Observing what was swallowed

The first three failure sites return a response instead of throwing, so pass
`onError` to keep them visible:

```ts
createRequestHandler({
  onError: (error, { pathname, site }) => reportToSentry(error, { pathname, site }),
  routes,
});
```

The Node adapter's own `onError` still catches anything that escapes the
handler entirely, and answers it with plain text.

## Working Example

[`examples/app-owned-fallbacks`](../../examples/app-owned-fallbacks) owns root and
nested loading, not-found, and error components. Its built-server probe verifies
the nearest fallback selection, inherited layouts around 404 documents,
layout-free error rendering, API problem details, typed statuses, and
production redaction.

## Dev and production run the same path

Route handling runs in a Vite middleware registered before Vite's own, so it
sees a request first. A second middleware, registered from the hook
`configureServer` returns, runs after Vite and turns anything Vite could not
serve into the same negotiated not-found production returns.

Dev used to answer an unmatched navigation with a bodiless shell and a 200
while production answered with an empty 404. Both now render the same document
with the same status.
