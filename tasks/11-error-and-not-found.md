# Error And Not-Found Handling

Tracking: #3

## Goal

Every request that fails gets a response the framework designed, in the format
the caller asked for. No blank pages, no HTML sent to an API client, no stack
traces in production, and a default plain enough that shipping it feels wrong.

## Position

A framework should ship a working 404 so nothing is ever blank, and it should
refuse to let an app reach production without deciding on its own. A generic
framework error page in front of real users is a failure of the framework, not
of the app that never got around to it.

That decision belongs in a file the developer can read and edit. A built-in is
a stopgap, and a scaffolded `@not-found.tsx` is a choice someone made.

## Decisions

### Format is negotiated, not configured

On an unmatched path there is no route to consult, so `accept` is the only
signal available. A request asking for `text/html` gets the not-found document.
Everything else gets `application/problem+json` per RFC 9457, which obsoleted
RFC 7807:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "instance": "/api/widgets/9"
}
```

Apps extend it with their own members. Problem Details is how the framework
pushes toward correct status codes and a parseable error shape instead of every
API inventing `{ "error": "..." }`.

### The build gate skips API-only apps

An app with no page routes never wants an HTML not-found document, and nagging
it would be user hostile. The framework reads the route manifest at build time,
so the gate fires only when at least one page route exists. A pure `/api` app
builds clean and gets problem+json for everything.

### Not-found renders inside inherited layouts

Layouts resolve from the requested pathname, so `/admin/nope` picks up
`/admin/@layout.tsx` when one exists. A 404 should keep the site's nav, footer,
and styles rather than looking like a different website.

A layout resolved that way may expect a session or run a loader that throws, and
`/admin/nope` is exactly where that happens. When a layout fails while rendering
a 404, fall back to the layout-free document instead of escalating to a 500. The
blank page is the outcome this whole design exists to prevent.

Prior art: Next App Router renders `not-found.tsx` inside the layouts above it.
SvelteKit renders `+error.svelte` inside the parent layout and keeps a separate
`src/error.html` for failures above the app. Remix replaces the failing route in
the nested tree so parent layouts survive. Nuxt is the counter-example, where
`error.vue` replaces the whole app. Three of four nest by default, and the two
that thought hardest about it built an explicit escape for a broken layout.

### A 500 is not one thing

Where the failure happened decides what the caller gets.

| Failure site | Response |
| --- | --- |
| Inside a page render | App `@error.tsx` renders a document |
| Inside an API route handler | `application/problem+json`, never HTML |
| Inside middleware or policy | Negotiate on `accept`, same rule as not-found |
| While rendering the error page | Plain text, no app code |

The last row matters most. Once the error path has failed, the app path cannot
be trusted a second time in the same request.

### Dev shows the stack, production never does

Production keeps today's guarantee that no stack trace, file path, or framework
internal reaches a response body. Dev shows the message, the stack, and the
route that failed. The switch is the build mode rather than an option, so it
cannot be misconfigured into leaking.

## Features To Implement

- ~~Content-negotiated not-found: document for HTML, problem+json otherwise.~~
  Shipped, #16.
- ~~Not-found rendering inside inherited layouts, with a layout-free
  fallback.~~ Shipped, #17.
- ~~Build gate requiring a root `@not-found.tsx` when the app has page
  routes.~~ Shipped, #18.
- ~~Error pipeline split by failure site.~~ Shipped, #19.
- ~~Dev error document with stack, production body unchanged.~~ Shipped, #20.
- Typed HTTP errors mapping to problem+json or the error document.
- `create-demiurge-app` scaffolding the fallbacks it expects apps to own.

## Examples Required

- `examples/app-owned-fallbacks`

`examples/node-server` owns a root `@not-found.tsx` and an `@error.tsx`, which
is what proves the build gate and the production error document. The dedicated
example still owes the failing-layout and failure-site walkthrough.

## Tests Required

- ~~Server tests for negotiation across `accept` values, including missing and
  malformed headers.~~ `tests/server/negotiate.test.ts`.
- ~~Server tests for each failure site in the 500 table.~~
  `tests/server/errors.test.tsx`.
- ~~A test proving a layout that throws during a 404 yields the layout-free
  document rather than a 500.~~ `tests/server/not-found.test.tsx`.
- ~~A build test proving the gate fires for a page app and stays quiet for an
  API-only app.~~ `tests/vite/plugin.test.tsx`.
- ~~A test proving no production error body contains a stack trace or file
  path.~~ `tests/server/errors.test.tsx`.

## Open Decisions

- Whether typed HTTP errors compose with the existing response capabilities or
  stay a throw-only path.

## Decisions Made While Implementing

- Page detection for the build gate is a source scan keyed on the `page` import
  from `demiurge`, not on the bare word and not on the file extension. The
  plugin cannot execute route modules at build time. A `page(` scan fires on
  `db.users.page(2)`, and an API-only app must never be told to write a 404
  document it will never serve; extension misses a page route whose view is
  imported rather than declared inline.
- The dev error document wins over the app's `@error.tsx` in dev, matching
  Next, Remix, and SvelteKit. The stack is the reason the document exists.
- The error document renders without layouts. The error path runs the least app
  code that can still produce a page.
- The first three failure sites return a response rather than throwing, so
  `createRequestHandler` gained an `onError` reporter to keep them observable.
- Dev registers a second middleware after Vite's own to terminate unmatched
  requests. Vite keeps serving its asset URLs, and everything else gets the
  production not-found.

Reference: `docs/09-errors-and-not-found.md`.
