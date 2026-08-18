# Conditional Script Example

This production Node example demonstrates the managed `<Script />` surface
loading a script conditionally, only on one route, and only once a visitor
grants consent.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The home route `/` never contributes a script. The `/dashboard` route
declares one through `export const scripts`, a request-aware contribution
that inspects the `consent` query parameter:

```ts
export const scripts = defineScripts(({ search }) => {
  if (search.get("consent") !== "granted") {
    return [];
  }

  return [script({ src: "/vendor/analytics", strategy: "afterInteractive" })];
});
```

Visiting `/dashboard` without `?consent=granted` renders the page with no
script tag at all. Visiting `/dashboard?consent=granted` adds the tag. The
framework resolves that decision on the server before the document renders.
The browser never requests the script unless consent was granted.

`/vendor/analytics` is a route handler, not a static file. It sleeps for
400ms before responding, standing in for a slow third-party tag. The script
carries `strategy: "afterInteractive"` and `async: true`, so the browser
fetches it without blocking hydration. The dashboard heading and its
hydration marker appear immediately, well before the analytics script
finishes loading and appends its own marker to the page.

A `pnpm test:browser` run drives a real browser through three cases. It
confirms the script never loads on `/`. It confirms the script never loads
on `/dashboard` without consent. It confirms the script loads on
`/dashboard` with consent, after hydration has already completed.
