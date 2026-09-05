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

A page route sends a Content-Security-Policy when a route-local or ancestor
policy declares a document CSP. Set `csp: false` when the route accepts no CSP.
A policy that declares `security` alone controls the request pipeline and leaves
the response without a Content-Security-Policy.

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

## Cookies

`createSecureCookie(...)` serializes a `set-cookie` value from a typed
declaration. The declaration names the cookie without a prefix. The `scope`
field selects the prefix, and Demiurge adds it:

| `scope` | Prefix | Browser requirement |
| --- | --- | --- |
| `"host"` (default) | `__Host-` | `Secure`, `Path=/`, and no `Domain` |
| `"secure"` | `__Secure-` | `Secure` |
| `"none"` | none | none |

A browser enforces these rules without server cooperation. A browser drops a
cookie that breaks them, and it reports nothing. The application sees a lost
session rather than a policy failure. So Demiurge validates each declaration
before it serializes the value.

```ts
import { createSecureCookie, secureCookieName } from "@demiurgejs/core";

const cookie = createSecureCookie({ name: "session", value: sessionId });
// __Host-session=...; Path=/; SameSite=Lax; HttpOnly; Secure

const name = secureCookieName("session");
// __Host-session
```

Every cookie defaults to `HttpOnly`, `Secure`, `Path=/`, and `SameSite=Lax`.
Declare `scope: "secure"` and a `domain` value to share a cookie with
subdomains. Declare `scope: "none"` for a cookie that carries no prefix. Only
an unprefixed cookie can drop `Secure`, which supports a plain HTTP development
host.

`createSecureCookie(...)` throws when a declaration breaks an invariant. The
message names the cookie and the change that repairs it. Demiurge never renames
an application cookie to satisfy a prefix. Use `validateSecureCookie(...)` to
read the same findings as a list of typed issues.

Read a cookie header back on the server with `parseCookieHeader(...)` and the
prefixed name. `createSecureCookie(...)` encodes the value with
`encodeURIComponent`, and `parseCookieHeader(...)` decodes it.

### Sharing a cookie definition with the browser

A route and a client script often need the same cookie identity. Declare the
shared part once, as a `SecureCookieDefinition`, in a module both sides
import, and spread it into the write:

```ts
// lib/cookies.ts — imported by the route and by the client script
import type { SecureCookieDefinition } from "@demiurgejs/core";

export const preferenceCookie: SecureCookieDefinition = {
  httpOnly: false,
  name: "preference",
  sameSite: "Strict",
};
```

```ts
// route
import { createSecureCookie } from "@demiurgejs/core";
import { preferenceCookie } from "../lib/cookies";

createSecureCookie({ ...preferenceCookie, value: "dark" });
```

```ts
// client script
import { readSecureCookie } from "@demiurgejs/core";
import { preferenceCookie } from "../lib/cookies";

const preference = readSecureCookie(preferenceCookie);
```

Neither side retypes the name or the scope. A rename in `preferenceCookie`
reaches the write and the read together. `readSecureCookie(...)` also accepts
a bare name for a cookie with no shared definition. It returns `undefined`
outside a browser and for a cookie the browser did not send.

### The JavaScript-readable exception

A cookie that page script must read carries `httpOnly: false`. The
double-submit CSRF token is the only supported use, because page script must
copy the token into a request header. The token is a random value that proves
same-origin script sent the request. It is not a credential, so a reader gains
nothing from it. Keep every session and authentication cookie on the `HttpOnly`
default.

### Cookie sessions

Use a signed cookie session when the application does not need to hide session
data from the browser.

Use an encrypted cookie session when the data also needs confidentiality. Both
implementations reject a modified value.

```ts
import { createEncryptedCookieSession } from "@demiurgejs/core";

const sessions = createEncryptedCookieSession<{
  authenticated: boolean;
  userId: string;
}>({
  keys: [
    { id: "current", value: currentKey },
    { id: "previous", value: previousKey },
  ],
});
```

Each key must contain at least 32 bytes. Generate key material with a secure
random source.

Put the current key first. The reader accepts each configured previous key and
commits the next value with the current key.

Open one request-scoped session for each request:

```ts
const session = await sessions.open(request);

if (!session.get()) {
  session.create({ authenticated: true, userId: "user-123" });
}

const headers = new Headers();
for (const cookie of await session.commit()) {
  headers.append("set-cookie", cookie);
}
```

Call `rotate()` after login or a privilege change. Call `destroy()` during
logout.

The default absolute lifetime is seven days. The default idle lifetime is 24
hours.

Set `idleExpirationMs: false` to disable idle expiration. Set `renewal: false`
to disable automatic idle renewal.

A signed cookie provides integrity only. Its data remains readable to the
browser owner.

An encrypted cookie provides confidentiality and integrity. Neither cookie
implementation can revoke a copied value before it expires.

Use a server-side session store when logout must revoke all copied session
values immediately.

Cookie size includes the protected value and all attributes. Demiurge rejects
a value above the browser limit.

Static output rejects a response that commits a session cookie. A static build
cannot publish request-specific session state.

### Server-side sessions

Use `createSessionManager(...)` when logout must revoke copied session values.
The cookie contains only a signed, opaque identifier.

```ts
import { createSessionManager } from "@demiurgejs/core";
import { createRedisSessionStore } from "@demiurgejs/core/redis";

const store = createRedisSessionStore({
  client: redis,
  namespace: {
    app: "storefront",
    environment: "production",
    schemaVersion: 1,
  },
});

const sessions = createSessionManager({ keys, store });
```

The manager uses the same lifecycle operations and expiration defaults as a
cookie session.

The manager signs the identifier cookie. Session data stays in the selected
store.

The memory store is process-local. Do not use it when requests can reach more
than one process or isolate.

The Redis store runs create, update, and rotation checks through atomic Lua
commands. Multiple clients observe immediate logout and rotation.

The KV store requires `EdgeKvSessionNamespace.atomic(...)`. Adapt the provider
transaction or compare-and-swap API to this method.

A plain eventually consistent KV binding does not satisfy the contract. The KV
integration rejects a client without the atomic method during construction.

The KV adapter must provide read-after-write consistency for keys in a completed
atomic operation.

Each store requires an explicit application, environment, and schema namespace.
This namespace prevents deployments from reading each other's sessions.

A write conflict throws `SessionStoreConflictError`. Load the current session
before another lifecycle operation.

A provider failure during a lifecycle write throws
`SessionStoreUnavailableError`. The manager does not emit a new cookie.

A provider read or delete error remains a provider error. The application can
apply its normal service failure policy.

## CSRF

Cookie-authenticated unsafe methods receive double-submit CSRF protection by
default. Use `issueCsrfToken(...)`, `createCsrfToken(...)`, and
`createCsrfCookie(...)` to issue the matching token and cookie. A route can make
an explicit, auditable exemption when another authentication model makes CSRF
inapplicable.

`createCsrfCookie(...)` keeps the unprefixed `csrf-token` name for
compatibility. Pass a `cookie` option to move the token to a prefixed name.

## Fetch Metadata resource isolation

A browser sends `Sec-Fetch-Site`, `Sec-Fetch-Mode`, and `Sec-Fetch-Dest` with
each request. Demiurge always gives these headers to a route handler. A route
can also make the framework read them and refuse the request.

The policy is opt-in. A route that does not declare it keeps its behavior.

```ts
import { json } from "@demiurgejs/core";

export const GET = json(readReport, {
  security: {
    fetchMetadata: true,
  },
});
```

Declare `fetchMetadata` in an `@policy.ts` file to guard a whole route group.

Demiurge rejects a request before the route body runs. It applies these rules:

- A request without `Sec-Fetch-Site` is allowed. An old browser and a
  server-to-server client send no Fetch Metadata.
- `same-origin` and `none` are allowed. `none` identifies a request that the
  user started, such as a bookmark.
- `same-site` is denied until the application sets `allowSameSite`. Another
  team or an attacker can control a sibling subdomain.
- A safe top-level navigation is allowed, so a person can enter the site from
  a link on another site. Set `allowNavigation: false` to deny it.
- Every other cross-site request receives status 403.

Two options make an intentional cross-origin resource explicit:

- `allowCrossSite` allows every cross-site request. Use it for a CORS API.
- `allowedDestinations` allows the listed `Sec-Fetch-Dest` values, for example
  `["image"]` for a public image endpoint.

A CORS preflight is exempt, because it carries no application data.

Demiurge adds a deduplicated `Vary` field for each `Sec-Fetch-*` header that
the decision read. A shared cache needs that field. Otherwise the cache can
give one client the response of another client.

The policy is defense in depth. It does not replace a CSRF token or a CORS
policy. Keep `csrf` and `cors` declarations on the routes that need them.

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

A document that declares no `csp` gets the `csp-missing` finding, because that
document sends no Content-Security-Policy. To accept a document without a
policy, declare `csp: false`. The finding then stops.

The development server shows this audit for one route. Read the
[route audit panel](./devtools.md) guide.

## Policy verification

The Vite plugin validates literal CORS, rate-limit, and document policy during
a production build. A finding identifies the route file and export.

The build also reads the policy cascade of the route tree. A page route that
has no effective CSP gets the `document-policy-missing` warning. A document
policy that declares only other headers also gets the warning. The warning
names the route file and does not stop the build. The development server gives
the same warning when it starts and after a route file changes. An explicit
`csp: false` value stops the warning. An unreadable policy gets no warning.

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

## Server-only module boundaries

Add `import "@demiurgejs/core/server-only";` to a module that must never enter
a browser build. The build fails when a browser bundle reaches the module,
through a direct import, a transitive import, a re-export, or a dynamic
import. The diagnostic names the module and the complete import path from the
client entry.

The bare `server-only` specifier is an equivalent marker. An application that
migrates from the community package of the same name keeps the same
protection.

The development server applies the same rule. The server fails as soon as the
browser requests a module that carries the marker. The server names the
module. It cannot give the import path, because it has not built the client
graph yet.

A server entry, an SSR transform, and a route module loaded only on the
server keep working. Reach the marked module through `@middleware.ts`,
`@policy.ts`, or a page route `data` function. The build then keeps that
module off the browser bundle without a failure.

This boundary complements the environment boundary above. The environment
boundary catches a server variable that client code reads. The server-only
boundary catches an entire module that client code must never load, whether
or not the module reads a declared variable.

## Cross-origin isolation

`security.crossOriginIsolated()` configures COOP, COEP, and CORP for features
that require an isolated browsing context. Every cross-origin subresource must
cooperate with that policy, so enable it only after auditing scripts, fonts,
images, workers, and embeds.
