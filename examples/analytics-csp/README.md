# Analytics CSP Example

This production Node example loads an analytics vendor script under
`security.strict()`. The policy carries no `unsafe-inline` source, because
the integration emits no inline snippet.

```sh
pnpm build
NODE_ENV=production pnpm start
```

`src/analytics.ts` declares the integration once:

```ts
export const plausible = analytics.plausible({
  domain: "analytics-csp.example",
  endpoint: "/stats",
});
```

The path endpoint describes a proxied deployment, which Plausible documents
for applications that would rather not name a third-party host. The route
policy takes the CSP sources from the same value:

```ts
export const policy = defineRoutePolicy(
  mergeRoutePolicies(
    { document: security.strict() },
    analytics.policy(plausible),
  ),
);
```

The page takes the script contribution from it:

```ts
export const scripts = defineScripts(analytics.scripts(plausible));
```

Removing either line fails at startup with a diagnostic that names the
directive the other half needs. `tests/integration/analytics-csp.ts` proves
both failures without starting a browser.

`public/stats/js/script.js` stands in for the proxied vendor tag. It reads
`data-api` and `data-domain` from its own script element, exactly as the
vendor script does, then posts one pageview to `/stats/api/event`.

A `pnpm test:browser` run drives a real browser through the page. It confirms
the response policy contains `'strict-dynamic'` and no `'unsafe-inline'`. It
confirms the framework attached a nonce to the vendor tag. It confirms the
beacon reached the API path without a Content Security Policy violation.
