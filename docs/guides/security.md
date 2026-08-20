# Security

Demiurge applies security policy in the shared route pipeline so development,
Node production, and static output use the same declarations.

## Inherited policy

Add `@policy.ts` at any route-tree level:

```ts
import { security } from "@demiurgejs/core";

export const policy = {
  document: security.strict(),
};
```

Policy merges root-to-leaf. A route helper may add capability-specific CORS,
request, or security options. Deliberate relaxations remain visible at the
route instead of hiding in unrelated global middleware.

CSP source arrays merge additively. Use `{ replace: [...] }` to replace an
inherited directive. Use `false` to remove one inherited directive.

Use `cspNonce` when a custom policy requires the framework nonce. Use a custom
source string when the built-in `CspSource` values do not contain the source.

## Strict documents

`security.strict()` provides a nonce-based Content Security Policy and HSTS on
HTTPS. It also provides `frame-ancestors 'none'`, `nosniff`, a referrer policy,
a permissions policy, and same-origin COOP and CORP defaults.

The framework-owned document attaches the request nonce to managed scripts,
JSON-LD, hydration data, and React streaming payloads. A dynamic policy that
requires a nonce fails closed when no nonce is available.

The strict preset blocks style attributes by default. A nonce cannot authorize
a style attribute. Use classes and an external stylesheet when possible.

If an application requires React style props, permit style attributes
explicitly:

```ts
security.strict({
  csp: {
    styleSrcAttr: ["'unsafe-inline'"],
  },
});
```

This directive permits all style attributes. The nonce requirement continues
to protect style elements.

Static output uses hash-based policy. `security.static()` and `cspHash(...)`
describe hashes that remain valid without a request nonce. Static generation
rejects nonce-dependent output and other policy it cannot deploy safely.

Static generation adds hashes for framework-rendered structured data. An
application must declare hashes for its other inline scripts.

A static build also applies the root document policy's security headers to
files that have no route entry. Hashed bundles and copied public files receive
that baseline. The Content Security Policy is not part of it. See
[Data and caching](./data-and-caching.md) for the file rules and for the
per-pattern override.

The Vite plugin disables automatic asset inlining by default. This setting
prevents generated data URLs from conflicting with the default CSP.

An application can set `build.assetsInlineLimit` explicitly. If the application
enables inlining, add `data:` to each applicable CSP directive.

Trusted Types is explicit because enabling enforcement can break third-party
code in browsers the application does not control. Report-only policy can send
violations to `createSecurityReportHandler(...)` before enforcement is enabled.

## Managed scripts

Use `<Script />` when a component conditionally needs an external script:

```tsx
import { Script } from "@demiurgejs/core";

export function PaymentForm() {
  return <Script src="https://js.stripe.com/v3/" strategy="afterInteractive" />;
}
```

Declare each conditional origin in the route policy:

```ts
export const policy = {
  security: {
    needs: { script: ["https://js.stripe.com"] },
  },
};
```

A need declares one directive at a time. `security.needs.connect` and
`security.needs.img` widen `connect-src` and `img-src` the same way, which is
what an analytics beacon or a tracking pixel requires. See the
[analytics guide](./analytics.md) for the typed vendor integrations built on
these declarations.

`security.needs.script` merges from the root to the leaf. The framework keeps
the first declaration for each source. A static `export const scripts` entry
therefore takes precedence over a managed component with the same source.

A script need adds its sources to `script-src` only. If the route policy does
not set `script-src`, the framework makes an explicit `script-src` from the
`default-src` sources and the declared sources. The framework does not change
`default-src`, because a wider `default-src` also grants the source to
`frame-src`, `worker-src`, `media-src`, and `manifest-src`. If the route policy
sets `csp.scriptSrc` to `false`, the framework rejects the policy at startup.
Set an explicit `csp.scriptSrc` for that route.

The framework hoists managed scripts found before the document head flushes.
It renders scripts found after the flush at their component position. In
development, a late `beforeInteractive` script fails and points to
`export const scripts`. In production, the framework renders that script in
place after the flush, so the strategy cannot provide an early-load guarantee.

## Script strategies

Five strategies describe when a script runs. The document orders them in the
same sequence.

| Strategy | Loading behaviour |
| --- | --- |
| `beforeInteractive` | A parser-blocking tag that runs before hydration. |
| `module` | A `type="module"` tag, deferred and run in module scope. |
| `afterInteractive` | A tag the browser fetches while it parses the document. |
| `idle` | A tag the client runtime adds during a browser idle period. |
| `worker` | A source the client runtime hands to the `Worker` constructor. |

`idle` and `worker` are deferred strategies. The document renders an inert
placeholder for them, with no `src` attribute, so parsing never fetches the
source. The client entry starts each placeholder after it hands the document to
React. An `idle` script then waits for `requestIdleCallback`, and falls back to
a macrotask in a browser without it. The loaded script goes into the head and
keeps the identity, integrity, and type the route declared.

A `worker` script never runs on the main thread and never becomes a document
script. The runtime constructs a `Worker` from the source, and the application
reads the handle with `getScriptWorker(src)`. Every worker starts before React
runs a route effect, so a route can read its handle on mount.

```tsx
export const scripts = defineScripts([
  script({ id: "report", src: "/vendor/report", strategy: "worker" }),
]);

const worker = getScriptWorker("/vendor/report");
```

The `worker` strategy is client-only, which is a real limit rather than a gap.
A server render, a static export, and an edge runtime have no `Worker`
constructor and no DOM to start one in. The runtime reports that case instead of
loading the source on the main thread.

The `Worker` constructor also needs a same-origin source and a policy that
allows it. Browsers resolve `worker-src` through `child-src` and `script-src`,
and the strict preset sets `script-src` to a nonce with `strict-dynamic`. That
combination refuses a worker URL. Declare `csp.workerSrc` on the route policy:

```ts
export const policy = defineRoutePolicy({
  document: security.strict({ csp: { workerSrc: ["'self'"] } }),
});
```

## CSRF

Cookie-authenticated unsafe methods receive double-submit CSRF protection by
default. Use `issueCsrfToken(...)`, `createCsrfToken(...)`, and
`createCsrfCookie(...)` to issue the matching token and cookie. A route can make
an explicit, auditable exemption when another authentication model makes CSRF
inapplicable.

## CORS and request policy

Response helpers accept typed CORS declarations. Demiurge validates origins,
methods, wildcard-plus-credentials combinations, emits preflight responses,
and applies the resulting headers through the same request pipeline.

A CORS origin must be an absolute HTTP or HTTPS origin. It cannot contain
credentials, a path, a query, or a fragment.

Static output has no request pipeline, so route-level CORS declarations do
not apply to it. The Vercel static adapter declares `access-control-allow-origin`
separately. See [Access-Control-Allow-Origin](./data-and-caching.md#access-control-allow-origin)
in the data and caching guide.

Route security can also enforce:

- allowed HTTP methods
- request-body and upload limits
- fixed-window rate limits with replaceable storage
- webhook HMAC verification against exact request bytes
  ([`examples/webhook-security`](../../examples/webhook-security))
- WebSocket origin checks

The Node adapter ignores forwarded identity headers until the application
declares a trusted proxy policy. Host allowlists are mandatory. These settings
prevent rate limits, secure URLs, and origin checks from trusting attacker-owned
headers.

## Reports and audits

`createSecurityReportHandler(...)` accepts CSP and Reporting API payloads with
media-type and body-size validation. It supports both compatibility `report-uri`
and named Reporting API endpoints.

`createSecurityAudit(...)` inspects effective route policy, rendered security
headers, static scripts, reporting configuration, and declared third-party
script dependencies. Audit findings explain policy conflicts. They do not
replace runtime reports for conditions that only a browser can observe.

## Policy verification

The Vite plugin validates literal CORS, rate-limit, and document policy during
a production build. A finding identifies the route file and export.

The build reads source without running route modules. The build does not guess
an environment-derived value or a value from a function call.

The build reads one file at a time, so it does not decide a requirement that
spans the cascade. A policy file that declares no reporting endpoints of its own
may name an inherited `csp.reportTo` group. A policy file that declares its own
endpoint map must name a member of that map. Startup validates the merged
policy either way.

CORS `methods` may list `OPTIONS`. Demiurge answers preflight itself, so no
route exports an OPTIONS capability to serve one.

Generated server entries pass eager modules to `createRequestHandler(...)`.
The handler validates dynamic policy before it accepts a request. A direct
adapter can pass `routeModules` and its `adapter` for the same startup check.

Request-time checks remain active after build and startup validation. They
protect applications that use custom build and startup paths.

See [ADR 0002](../../architecture/decisions/0002-static-policy-verification.md)
for the accepted boundary. [Issue #184](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/184)
carries the wider proposal's open decisions and later consumers.

## Environment validation

`defineEnvSchema(...)`, `env.*(...)`, and `validateEnv(...)` validate required
configuration and secrets before request handling begins. Keep secrets on the
server and pass only deliberate public values into document or browser data.

## Cross-origin isolation

`security.crossOriginIsolated()` configures COOP, COEP, and CORP for features
that require an isolated browsing context. Every cross-origin subresource must
cooperate with that policy, so enable it only after auditing scripts, fonts,
images, workers, and embeds.
