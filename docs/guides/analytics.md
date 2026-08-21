# Analytics and observability

Analytics vendors ship a script and a set of network calls. Under a strict
Content Security Policy both halves need declarations. A hand-pasted snippet
carries neither, which is why teams reach for `unsafe-inline`.

Demiurge describes each vendor as a typed integration. An integration returns
the script contributions the document renders and the CSP sources the policy
needs. Wiring only one half fails the build with a diagnostic.

## Shape of an integration

```ts
import { analytics } from "@demiurgejs/core";

const plausible = analytics.plausible({ domain: "example.com" });
```

Every integration returns the same shape:

- `scripts` is a list of managed script tags for `export const scripts`
- `needs` is the CSP source list for `connect`, `img`, and `script`
- `consent` records whether the application must gate the script
- `provider` and `kind` identify the integration in an audit

Two helpers combine several integrations:

```ts
// src/routes/@policy.ts
export const policy = defineRoutePolicy(
  mergeRoutePolicies(
    { document: security.strict() },
    analytics.policy(plausible, sentry),
  ),
);

// src/routes/index.tsx
export const scripts = defineScripts(analytics.scripts(plausible, sentry));
```

The script goes through the managed `<Script />` pipeline. The framework
attaches the request nonce, hoists the tag into the head, and applies the same
audit rules it applies to every other script. No inline snippet is involved.

## Plausible

```ts
analytics.plausible({ domain: "example.com" });
```

Plausible loads one script and carries its configuration in `data-domain`.
The helper emits `https://plausible.io/js/script.js` with `defer`, and points
`data-api` at `https://plausible.io/api/event`.

| Directive | Source |
| --- | --- |
| `script-src` | the endpoint origin |
| `connect-src` | the endpoint origin |

`endpoint` accepts a different HTTPS origin for a self-hosted install. It also
accepts a same-origin path prefix such as `/stats` for a proxied deployment.
A proxied endpoint needs `'self'` in both directives instead of a vendor host.

## Sentry

```ts
analytics.sentry({ dsn: "https://<publicKey>@<host>/<projectId>" });
```

Sentry publishes a loader script whose filename carries the public key, so the
browser needs no inline configuration call. The helper derives the loader URL,
the ingest origin, and the project identifier from the DSN.

| Directive | Source |
| --- | --- |
| `script-src` | `https://js.sentry-cdn.com`, or `loaderHost` |
| `connect-src` | the DSN origin |

The loader defaults to the `beforeInteractive` strategy, because an error
thrown during startup is the one an application can least afford to lose. Pass
`strategy` to move it later.

A DSN origin under `ingest.sentry.io` also matches a wildcard host source such
as `https://*.ingest.sentry.io`, so an existing policy keeps working.

## OpenTelemetry

OpenTelemetry publishes no hosted browser loader. Browser instrumentation is
application code, bundled from npm packages and served from the application
origin. The framework describes the part a policy has to know about:

```ts
analytics.openTelemetry({
  endpoint: "https://collector.example.com/v1/traces",
  script: "/instrumentation.js",
});
```

| Directive | Source |
| --- | --- |
| `connect-src` | the collector origin |
| `script-src` | `'self'` when `script` is set |

`script` is optional and must be a same-origin path. Without it the helper
declares the exporter endpoint alone, which suits an application that starts
the SDK from its own client entry.

## Core Web Vitals

Core Web Vitals need no vendor script. The framework collects them in the
browser with `PerformanceObserver` and posts them to an endpoint that the
application owns. The framework sends no measurement to a third party.

Declare the integration once:

```ts
// src/web-vitals.ts
import { defineWebVitals } from "@demiurgejs/core";

export const vitals = defineWebVitals({ endpoint: "/api/vitals" });
```

`endpoint` is a same-origin path or an HTTPS URL. `metrics` selects a subset of
`CLS`, `FCP`, `INP`, `LCP`, and `TTFB`. `sampleRate` is a number from 0 to 1,
and the collector decides once for each page load.

The route policy takes the CSP source from the same value:

```ts
// src/routes/@policy.ts
export const policy = defineRoutePolicy(
  mergeRoutePolicies(
    { document: security.strict() },
    webVitalsPolicy(vitals),
  ),
);
```

| Directive | Source |
| --- | --- |
| `connect-src` | `'self'`, or the endpoint origin |
| `script-src` | no source, because the collector is application code |

Mount the collector once in the root layout:

```tsx
// src/routes/@layout.tsx
import { WebVitals } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      {children}
      <WebVitals integration={vitals} />
    </>
  );
}
```

The component renders nothing. It starts the collector after hydration and
stops it when it unmounts. `collectWebVitals(vitals)` does the same work
without React, and it returns a function that stops the collector.

### The beacon

The collector holds each measurement until the page hides, then posts one
beacon through `navigator.sendBeacon`. A browser that refuses the beacon gets
a `keepalive` fetch instead. The body carries one field:

```json
{
  "metrics": [
    {
      "id": "LCP-1735689600000-123456789",
      "name": "LCP",
      "navigationType": "navigate",
      "rating": "good",
      "url": "https://example.com/",
      "value": 1842
    }
  ]
}
```

`rating` comes from the published limits, which `WEB_VITAL_THRESHOLDS` and
`webVitalRating(name, value)` also expose.

### The endpoint

The application owns the route. `readWebVitalsBeacon` validates every field
before the handler forwards a report:

```tsx
// src/routes/api/vitals.tsx
export const POST = response(async ({ request }) => {
  const beacon = await readWebVitalsBeacon(request);

  if (!beacon.ok) {
    return Response.json({ reason: beacon.reason }, { status: 400 });
  }

  for (const metric of beacon.metrics) {
    await instrumentation.reportWebVitals(metric);
  }

  return new Response(null, { status: 202 });
}, {
  security: {
    csrf: false,
    rateLimit: { key: "ip", limit: 600, window: "1m" },
    request: { maxBodySize: "8kb" },
  },
});
```

A report is also a `WebVitalSignal`, so `instrumentation.reportWebVitals` takes
it without a conversion. See [`defineInstrumentation`](#server-instrumentation)
for the server side of the same pipeline.

`navigator.sendBeacon` sends no CSRF token and no custom header, so the route
turns the CSRF check off. Set a rate limit and a body size limit instead.

The result reports one of three rejections:

- `unreadable-body` for a body that is not JSON
- `invalid-payload` for a field outside the contract
- `too-many-metrics` for a beacon above the limit

`maxMetrics` changes that limit, which defaults to 32.

## Server instrumentation

`defineInstrumentation` takes the handlers that receive each signal. The
`webVitals` handler receives every report the endpoint accepts.

```ts
const instrumentation = defineInstrumentation({
  webVitals: (signal) => metrics.record(signal.name, signal.value),
});
```

## Consent

`consent` is a declaration the application acts on. Set `consent: "required"`
and gate the contribution on a request-aware `defineScripts` function:

```ts
export const scripts = defineScripts(({ search }) =>
  search.get("consent") === "granted" ? analytics.scripts(plausible) : []
);
```

See [`examples/conditional-script`](../../examples/conditional-script) for the
full consent pattern under a strict policy.

## How a misconfiguration fails

Startup and the production build validate the effective policy against every
static script contribution. Two diagnostics cover the two halves.

A contributed script that the effective `script-src` cannot authorize fails
with the script source and the directive that blocked it:

```text
Route "./routes/index.tsx" export GET declares script
"https://plausible.io/js/script.js" that violates the effective
script-src 'self' policy.
```

A script whose beacon or pixel needs a directive the policy omits fails with
the directive, the origin, and the two ways to grant it:

```text
Route "./routes/index.tsx" export GET declares script
"https://plausible.io/js/script.js" that needs connect-src
https://plausible.io, which the effective policy does not allow. Add
https://plausible.io to security.needs.connect or to csp.connectSrc for
this route.
```

A route that removes a directive outright, and still declares a need for it,
fails at merge time. A need widens one directive only, so the framework
refuses to widen `default-src` on its behalf:

```text
A route policy declares security.needs.connect and sets csp.connectSrc to
false. Set an explicit csp.connectSrc that includes https://plausible.io.
```

## Declaring needs by hand

An integration is a convenience over `security.needs`, which any route can use
for a vendor the framework does not model:

```ts
export const policy = defineRoutePolicy({
  document: security.strict(),
  security: {
    needs: {
      connect: ["https://api.vendor.example"],
      img: ["https://pixel.vendor.example"],
      script: ["https://cdn.vendor.example"],
    },
  },
});
```

Each entry widens exactly one directive. A managed script can declare the
directives its own traffic needs, which is what makes the build check
possible:

```ts
script({
  needs: { connect: ["https://api.vendor.example"] },
  purpose: "analytics",
  src: "https://cdn.vendor.example/tag.js",
});
```

## Example

[`examples/analytics-csp`](../../examples/analytics-csp) serves a proxied
Plausible deployment under `security.strict()`. A browser test proves the
script loads with a framework nonce, the beacon reaches the API path, and the
policy carries no `unsafe-inline` source.

[`examples/observability`](../../examples/observability) reports Core Web
Vitals to its own endpoint under `security.strict()`. A browser test proves
the collector posts a beacon on page hide and causes no policy violation.

See the [security guide](./security.md) for the policy cascade and for the
managed script rules these integrations build on.
