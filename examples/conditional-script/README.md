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

## Loading strategies

The `/strategies` route contrasts three strategies on one page:

```ts
export const scripts = defineScripts([
  script({ async: true, src: "/vendor/eager-tag", strategy: "afterInteractive" }),
  script({ src: "/vendor/idle-tag", strategy: "idle" }),
  script({ src: "/vendor/worker-task", strategy: "worker" }),
]);
```

The document ships the idle and worker entries as inert placeholders. Neither
carries a `src` attribute, so parsing the document fetches neither source. The
client entry starts both after it hands the document to React.

`/vendor/eager-tag` runs while the browser parses the document. It then holds
the main thread through a chain of blocking tasks for about 1.2 seconds. React
hydrates between those tasks, and the page records when that happened.

`/vendor/idle-tag` records its own load time. The browser reports an idle
period only once the blocking chain lets go, so this tag lands hundreds of
milliseconds after the eager one. The browser test compares both the recorded
times and the two network requests.

`/vendor/worker-task` is a worker source, not a document script. The page reads
the handle with `getScriptWorker` and asks the worker to block for 600ms. A
main thread task runs during that block, which proves the work left the main
thread. The route policy sets `csp.workerSrc`, because the strict preset alone
would refuse the worker URL.
