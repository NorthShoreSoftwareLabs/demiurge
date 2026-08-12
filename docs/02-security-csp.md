# Security And Strict CSP

Security is a core framework feature, not a middleware garnish.

## Goals

1. Strict CSP works out of the box.
2. React SSR, streaming SSR, RSC, hydration, and prerendering all have explicit
   CSP strategies.
3. The framework owns nonce generation and propagation.
4. Inline scripts are avoided unless they are nonce-backed or hash-backed.
5. Bootstrap data is serialized without executable inline JavaScript when
   possible.
6. Security headers have strong defaults with route-level escape hatches.
7. CORS is explicit and typed.
8. Development mode may loosen policy, but production mode should not inherit
   dev compromises.
9. CSRF, rate limits, request size limits, upload limits, and webhook
   verification are first-class route concerns.
10. Trusted Types is supported as an opt-in strict preset with compatibility
    diagnostics.

## Default Security Headers

Initial production preset:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'nonce-{nonce}' 'strict-dynamic'; style-src 'self' 'nonce-{nonce}'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; upgrade-insecure-requests
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000
```

Optional, deployment-dependent headers:

```http
Cross-Origin-Embedder-Policy: require-corp
Origin-Agent-Cluster: ?1
```

The strict preset sends HSTS only for HTTPS requests. Its one-year policy is
limited to the current host: `includeSubDomains` and `preload` are deliberately
off because either can break independently deployed subdomains and is difficult
to reverse after browsers cache it. Applications that control their entire
domain can opt into those directives by overriding `strictTransportSecurity`.
Plain-HTTP development responses never carry HSTS.

`COEP: require-corp` plus `COOP: same-origin` enables cross-origin isolation
for features like `SharedArrayBuffer`, but it can break third-party assets that
do not send CORS or CORP headers. It should be a named preset rather than always
on.

## CSP Strategy

### Dynamic SSR

Dynamic SSR can use a per-request nonce:

1. Generate a cryptographically random nonce.
2. Put it in `script-src` and `style-src`.
3. Attach it to every framework-managed `<script>` and `<style>`.
4. Expose it to server rendering through a typed request context.
5. Never expose it to client code as app data.

The framework-owned document renderer can apply a provided nonce to static
document scripts and the framework client entry, while preserving an explicit
nonce on a script contribution.

A nonce-backed document is not a reusable HTTP-cache representation. CSP
requires the server to generate a unique nonce each time it transmits the
policy, so a CDN must not replay one cached nonce-bearing document to multiple
requests and a browser must not reuse one as a fresh document response. Until
the framework synthesizes these cache restrictions, applications and adapters
must mark nonce-backed documents `Cache-Control: no-store`. Static or otherwise
replayable documents need a hash/static CSP instead.

This does not prevent caching work below the HTTP response. The origin may cache
data or a nonce-free render artifact and then wrap it with a fresh nonce and CSP
for each response. The cache-layer and rendering-mode limitations are recorded
in `docs/04-data-and-static-generation.md`.

```ts
export const GET = react({
  server: "ssr",
  csp: "nonce",
  render(ctx) {
    return <App nonce={ctx.security.cspNonce} />;
  },
});
```

### Static Prerendering

Static HTML cannot use per-request nonces unless an edge/server mutates the HTML
on every response. Static routes should prefer hashes for stable framework
scripts or external script files with SRI.

```ts
export const GET = react({
  prerender: true,
  csp: "hash",
  render: () => <MarketingPage />,
});
```

The first static CSP slice exposes a static preset and deterministic hash helper:

```ts
import { createSecurityHeaders, cspHash, security } from "demiurge";

createSecurityHeaders(
  security.static({
    csp: {
      scriptSrc: ["'self'", await cspHash("console.log('stable')")],
    },
  }),
);
```

Unlike the strict nonce preset, the static preset renders without a per-request
nonce and is suitable for build-time CSP composition.

### React Streaming SSR

Routes opt into React streaming with `render: { mode: "streaming" }`. Demiurge
creates the document nonce before rendering, applies it to static managed
scripts and the client entry, and passes the same value to
`renderToPipeableStream(...)`. React's inline Suspense completion scripts
therefore satisfy the response's nonce-backed `script-src` policy.

Metadata, resource hints, and static script contributions resolve before the
shell is committed. A script discovered while a component renders cannot hoist
into an already-sent head; render-discovered scripts remain unsupported until
that ordering has an explicit API and CSP diagnostic.

An exception before `onShellReady` still enters the normal page error pipeline
and can return status 500. Once the shell is returned, headers are committed: a
later boundary failure is reported through the request handler but the status
remains 200 while React emits its client-recovery instructions. Cancelling the
response body aborts the React render and is not reported as an application
failure.

### React Server Components

Initial Flight chunks use escaped inline scripts that append to a
framework-owned queue. The client consumes buffered chunks, replaces the
queue's push handler, and feeds later chunks into a `ReadableStream`. Textual
chunks are escaped for their JavaScript and HTML context, binary chunks are
base64-encoded, and every queue script carries the same per-response nonce as
React's streaming completion scripts. Separately requested Flight responses
remain data responses under their dedicated content type and do not need a
script nonce.

### Partial Prerendering

Partial prerendering does not serve a build-time HTML document directly. The
build produces an internal React prelude plus opaque postponed state. On each
request, a runtime adapter generates the document nonce, renders the
framework-owned prefix, writes the cached prelude, resumes the dynamic
boundaries with the same nonce, and finishes the document suffix and client
entry.

```ts
page({
  render: { mode: "prerender" },
  view: ProductPage,
});
```

The prelude is a cacheable internal artifact rather than an HTTP response, so it
does not need a hash CSP or embedded nonce. The completed response remains
consistently nonce-backed. A static-only adapter cannot fill request-time holes
and must reject a partially prerendered result; it may emit a `prerender` route
only when the build completes the whole tree.

## CORS

CORS should be route-level and explicit:

```ts
export const POST = json(handler, {
  cors: {
    origins: ["https://app.example.com"],
    methods: ["POST"],
    headers: ["content-type", "authorization"],
    credentials: true,
    maxAge: 600,
  },
});
```

Framework responsibilities:

- Generate correct preflight responses.
- Make wildcard plus credentials invalid.
- Type-check allowed methods against exported route methods.
- Keep CORS separate from CSP and CORP. They solve different problems.

The first CORS slice supports helper-attached route policy:

```ts
export const POST = json(handler, {
  cors: {
    origins: ["https://app.example.com"],
    methods: ["POST"],
    headers: ["content-type", "authorization"],
    credentials: true,
    maxAge: 600,
  },
});
```

The framework adds CORS headers to actual route responses and generates
`OPTIONS` preflight responses when the requested method maps to a route
capability with CORS policy. Allowlist-backed responses always carry
`Vary: Origin`, including requests with a missing or denied origin, so a shared
cache cannot reuse the wrong CORS variant. Wildcard origins with credentials
fail closed. Credentialed policies must also list allowed and exposed headers
explicitly, and `maxAge` is validated as a non-negative integer number of
seconds.

## CSRF

Cookie-authenticated unsafe methods get CSRF protection by default.

```ts
import { text } from "demiurge";

export const POST = text(({ request }) => request.text());
```

For `POST`, `PUT`, `PATCH`, and `DELETE`, the presence of a non-empty `Cookie`
header activates double-submit validation. The default `csrf-token` cookie must
match the `x-csrf-token` request header. The route handler does not run when the
tokens are missing or differ.

Tokenless API requests that carry no cookies are unaffected. This keeps bearer
token, signed request, and other non-cookie authentication flows usable without
an exemption while protecting browser credential flows by default.

Issue the token from a deliberate same-origin endpoint or document action:

```ts
import { issueCsrfToken, response } from "demiurge";

export const GET = response(() => {
  const issued = issueCsrfToken();

  return new Response(JSON.stringify({ token: issued.token }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "set-cookie": issued.cookie,
    },
  });
});
```

The cookie defaults to `csrf-token=<token>; Path=/; SameSite=Lax; Secure`. It is
intentionally not `HttpOnly`: double-submit clients must read it or receive the
same token in bootstrap data and copy it into `x-csrf-token`. Tokens contain 256
bits from Web Crypto and use an unpadded URL-safe base64 representation.
`createCsrfToken()` and `createCsrfCookie(...)` are also available separately.
Only local HTTP development should pass `{ secure: false }`.

Reissue the token after login, logout, account switching, or any privilege
change. Explicit issuance is deliberate: automatically adding `Set-Cookie` to
every document would make public HTML responses personalized and interfere with
browser/CDN caching. Token endpoints and responses containing a newly issued
token should use `Cache-Control: no-store`.

Routes can require validation even before another cookie is present, or replace
the token names:

```ts
export const POST = text(handler, {
  security: {
    csrf: {
      cookie: "demo-csrf",
      header: "x-demo-csrf",
    },
  },
});
```

Framework responsibilities:

- Exempt verified webhooks and explicit tokenless API routes only through typed
  route policy.
- Support progressive enhancement for forms.
- Make same-site cookie settings visible in security audit output.
- Generate and serialize secure double-submit tokens without requiring apps to
  hand-roll entropy or cookie attributes.

An endpoint that is intentionally cross-origin can opt out in its route policy:

```ts
import { defineRoutePolicy } from "demiurge";

export const policy = defineRoutePolicy({
  security: {
    csrf: false,
  },
});
```

`csrf: false` is deliberately visible and appears as an informational security
audit finding. `webhook.hmac(...)` declares this exemption itself because its
signature verification is the request-authentication boundary.

### Migration From Opt-In CSRF

Earlier `0.0.1` builds enforced CSRF only when a route declared `csrf: true`.
After this change, an unsafe request with any cookie is rejected unless it also
sends matching double-submit tokens. Existing cookie-authenticated clients must
send:

- cookie: `csrf-token=<token>`
- header: `x-csrf-token: <token>`

For a route that does not use cookies as authentication and must accept requests
that happen to carry cookies, add `security.csrf: false` at the route or an
inherited `@policy.ts`. Do not add the exemption to cookie-authenticated routes.
CSRF failures still preserve the capability's CORS headers.

## Rate Limits And Request Limits

Rate limiting and request size limits should be typed policy, not scattered
middleware snippets.

```ts
import { defineRoutePolicy } from "demiurge";

export const policy = defineRoutePolicy({
  security: {
    rateLimit: {
      key: "ip",
      limit: 60,
      window: "1m",
    },
    request: {
      maxBodySize: "1mb",
      allowedMethods: ["GET", "POST"],
    },
  },
});
```

For authenticated routes:

```ts
rateLimit: {
  key: "user",
  limit: 300,
  window: "1m",
}
```

Adapters must declare whether they can enforce rate limits locally, through a
shared cache, or through platform features.

## Secret And Env Validation

Runtime configuration should fail closed before request handling starts:

```ts
import { defineEnvSchema, env, validateEnv } from "demiurge";

const schema = defineEnvSchema({
  API_ORIGIN: env.url({ protocols: ["https:"] }),
  NODE_ENV: env.enum(["development", "production", "test"]),
  PORT: env.integer({ min: 1, max: 65_535 }),
  SESSION_SECRET: env.secret({ minLength: 32 }),
});

const config = validateEnv(schema, process.env);
```

The first env validation slice parses strings, secrets, URLs, integers,
booleans, and string enums from an explicit environment source. Missing and
invalid variables are reported together through `EnvValidationError`, and
secret schema entries are marked as sensitive so diagnostics can avoid leaking
values.

## WebSocket Origin Checks

WebSocket routes need explicit origin checks because browser upgrade requests
can carry cookies and other ambient credentials:

```ts
import { enforceWebSocketOrigin } from "demiurge";

const rejected = enforceWebSocketOrigin(
  { origins: "same-origin" },
  request,
);
```

The first WebSocket security slice provides `checkWebSocketOrigin(...)` for
structured diagnostics and `enforceWebSocketOrigin(...)` for a fail-closed `403`
response. Exact allowlists can use normalized origins such as
`https://app.example.com`; `origins: "same-origin"` compares against the request
URL's own origin. Missing origins are rejected unless the policy explicitly sets
`allowMissingOrigin: true` for trusted non-browser clients.

## Security Report Endpoint

Applications should be able to collect browser security reports without writing
ad hoc JSON parsing in every route:

```ts
import { createSecurityReportHandler, response } from "demiurge";

const report = createSecurityReportHandler({
  maxBodySize: "32kb",
  onReport(payload) {
    securityLogger.write(payload);
  },
});

export const POST = response(({ request }) => report(request));
```

The first report endpoint slice accepts CSP report payloads and batched
Reporting API arrays, calls an optional `onReport` callback once per normalized
report, rejects non-POST methods with `405`, rejects malformed JSON with `400`,
and enforces an optional `maxBodySize` against bytes as they are consumed. A
declared `Content-Length` above the limit is still rejected before reading.

The first request-limit slice supports helper-attached request body limits:

```ts
export const POST = text(({ request }) => request.text(), {
  security: {
    rateLimit: {
      key: "ip",
      limit: 60,
      window: "1m",
    },
    request: {
      allowedMethods: ["POST"],
      maxBodySize: "1mb",
    },
  },
});
```

The server and Vite dev handlers reject requests whose declared
`Content-Length` exceeds the route limit before the handler reads the body.
They also count actual bytes while chunked or understated bodies are consumed
and return the same `413` when the stream crosses the limit. Malformed declared
lengths on limited routes fail with `400`.
Route-level `allowedMethods` additionally returns `405` before the handler runs
when a route capability exists but policy disallows that method. `HEAD` is
allowed when `GET` is allowed.

The first rate-limit slice adds fixed-window helper-attached limits. The default
server handler uses a per-handler memory store; production adapters can provide
a shared store through `createRequestHandler({ rateLimitStore, routes })`.

IP keys use connection metadata resolved by the adapter, never raw forwarding
headers from the Web `Request`. The Node adapter trusts no proxy by default, so
a directly exposed client cannot rotate `X-Forwarded-For` to evade a limit.
Configure either an explicit hop count or trusted IP/CIDR ranges on
`createNodeServer(...)`; the same policy resolves forwarded client address,
scheme, and host. `allowedHosts` is required and rejects an unexpected direct or
trusted-forwarded authority with `421` before application code runs.

The built-in memory store is process-local and bounded to 10,000 keys. It
opportunistically removes expired windows without starting a timer, and evicts
the oldest remaining key when the ceiling is reached. Raise or lower the ceiling
with `createMemoryRateLimitStore({ maximumEntries })`; production systems that
need a global limit across processes must supply a shared `RateLimitStore`.
Rate-limit rejections return `429` with `Retry-After` and `X-RateLimit-*`
headers before the handler reads the body.

## Uploads

Uploads need explicit limits and streaming support:

```ts
export const POST = action({
  body: multipart({
    maxBodySize: "20mb",
    files: {
      image: {
        maxSize: "5mb",
        allowedTypes: ["image/png", "image/jpeg", "image/webp"],
      },
    },
  }),
  handler,
});
```

Framework responsibilities:

- Enforce body size limits before buffering large payloads.
- Support streaming multipart parsing where adapters allow it.
- Provide presigned upload helpers for large direct-to-storage uploads.
- Keep upload policy visible in route audit output.

The first upload limits slice validates already-parsed `FormData` uploads:

```ts
const result = validateUploads(formData, {
  files: {
    image: {
      maxSize: "5mb",
      required: true,
      types: ["image/png", "image/jpeg", "image/webp"],
    },
  },
  maxTotalSize: "20mb",
});
```

`validateUploads(...)` returns normalized file groups, total uploaded byte size,
and structured issues for missing required files, per-file size violations,
MIME/type mismatches, and total upload size violations. Streaming multipart
parsing and direct-to-storage presigned upload helpers remain future adapter
slices.

## Webhook Verification

Webhook routes should have first-class verification helpers:

```ts
export const POST = webhook.stripe({
  secret: env.STRIPE_WEBHOOK_SECRET,
  handler: async ({ event }) => {
    // event is verified and typed
  },
});
```

Framework responsibilities:

- Preserve raw request body when signature verification requires it.
- Disable CSRF for verified webhook handlers without making the route broadly
  unsafe.
- Type event payloads when integration packages can provide types.
- Provide replay/timestamp validation hooks.

The first webhook slice provides a generic HMAC helper:

```ts
import { webhook } from "demiurge";

export const POST = webhook.hmac({
  secret: env.WEBHOOK_SECRET,
  handler: async ({ rawBody, text }) => {
    return Response.json({ received: rawBody.length, event: JSON.parse(text()) });
  },
});
```

The helper verifies the exact request bytes with Web Crypto before the app
handler runs. `rawBody` is a `Uint8Array`; call `text()` only when the provider's
payload is documented as text. Hex and padded base64 signatures are supported.
The conventional algorithm prefix (for example `sha256=`) is recognized
without confusing base64 padding; set `prefix` for a provider-specific prefix,
or `false` to disable stripping. The verified route declares its CSRF exemption.
Provider-specific helpers can build on this primitive.

## Trusted Types

Trusted Types should be an opt-in strict preset, not silently enabled for every
app on day one. It is powerful, but many JavaScript libraries still assume they
can assign raw strings to DOM XSS sinks such as `innerHTML`.

Potential API:

```ts
security.strict({
  trustedTypes: {
    mode: "report-only",
    policies: ["demiurge", "dompurify"],
  },
});
```

Production-hardened mode:

```ts
security.strict({
  trustedTypes: {
    mode: "enforce",
    policies: ["demiurge"],
    requireFor: ["script"],
  },
});
```

Trusted Types travels as CSP directives rather than headers of its own. There is
no `trusted-types:` header, so `trusted-types` and `require-trusted-types-for`
are appended to the document policy:

```http
Content-Security-Policy: default-src 'self'; require-trusted-types-for 'script'; trusted-types demiurge dompurify
```

Report-only mode moves those two directives to
`Content-Security-Policy-Report-Only` and leaves the rest of the policy
enforcing, which is why a response can carry both headers at once. The
report-only header carries only the Trusted Types directives, because repeating
the base policy there would report every ordinary CSP violation twice.

Framework responsibilities:

- Append the `trusted-types` and `require-trusted-types-for` directives to the
  effective policy, in the enforced or the report-only header as the mode says.
- Provide a framework-owned policy for internal sinks.
- Integrate with safe HTML helpers instead of raw string injection.
- Report incompatible third-party scripts and client libraries.
- Allow route-level report-only rollout before enforcement.

Compatibility strategy:

1. Start with `report-only`.
2. Collect violation reports through the built-in security report endpoint.
3. Provide diagnostics mapping violations to route/component/script origins.
4. Move compatible routes to enforcement.
5. Keep explicit, reasoned exceptions for third-party libraries that cannot yet
   comply.

Trusted Types belongs in the same audit surface as CSP because both are
document/runtime security contracts.

## Security Audit Output

Implemented security policy should be inspectable without issuing a real
request:

```ts
import { createSecurityAudit, security } from "demiurge";

const audit = createSecurityAudit({
  document: {
    headers: { nonce },
    policy: security.strict(),
  },
  route: {
    method: "POST",
    security: {
      csrf: true,
      rateLimit: { key: "ip", limit: 60, window: "1m" },
      request: { maxBodySize: "1mb" },
    },
  },
});
```

The first audit slice returns rendered headers, the effective route security
policy passed to the audit, and structured findings for invalid CORS, missing
unsafe-route controls, explicit CSRF exemptions, and header rendering failures.

## Per-Route Policy

Routes should be able to tighten or loosen policy intentionally:

```ts
export const GET = react({
  security: {
    csp: {
      connectSrc: ["'self'", "https://api.example.com"],
      imgSrc: ["'self'", "https://images.example.com"],
    },
    headers: {
      crossOriginEmbedderPolicy: "require-corp",
    },
  },
  render: () => <Dashboard />,
});
```

Security policy composition should work from app to layout to route:

```ts
import { defineSecurityPolicy, mergeSecurityPolicies, security } from "demiurge";

export const appPolicy = defineSecurityPolicy(security.strict());

export const routePolicy = mergeSecurityPolicies(appPolicy, {
  csp: {
    connectSrc: ["https://api.example.com"],
  },
  headers: {
    crossOriginEmbedderPolicy: "require-corp",
  },
});
```

The first cascade slice exposes `defineSecurityPolicy(...)` and
`mergeSecurityPolicies(...)`. CSP source directives merge additively with
de-duplication, while scalar headers and Trusted Types settings use child
override semantics. A child policy can explicitly disable inherited CSP with
`csp: false`.

HTTP route security policies can be exported from inherited `@policy.ts` files
with `defineRoutePolicy(...)`. The request handler merges matching policy files
root-to-leaf, then merges any route-module policy and capability-level security
before enforcing CSRF, rate limits, allowed methods, and body size limits.

The framework should expose named presets:

```ts
import { createSecurityHeaders, security } from "demiurge";

createSecurityHeaders(security.preset("strict"), { nonce });
createSecurityHeaders(security.preset("cross-origin-isolated"), { nonce });
createSecurityHeaders(security.preset("static"));
createSecurityHeaders(security.preset("api"));
```

The first implemented slices expose strict, cross-origin-isolated, static, and
API presets plus deterministic header rendering. Strict CSP uses a nonce
placeholder and fails if headers are rendered without the per-request nonce.

## Metadata And Document Contributions

Metadata should be a first-class route/layout export, not arbitrary raw head
markup.

```ts
import { defineMetadata } from "demiurge";

export const metadata = defineMetadata({
  title: "Checkout",
  description: "Complete your order securely.",
  canonical: "/checkout",
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "Checkout",
  },
});
```

Layouts can provide defaults:

```ts
import { defineMetadata } from "demiurge";

export const metadata = defineMetadata({
  title: {
    default: "Demiurge",
    format: (title) => `${title} | Demiurge`,
  },
  description: "A tiny React framework built from first principles.",
});
```

Leaf metadata wins for specific fields. Parent layouts can supply defaults and
formatters. We should avoid placeholder formats like `%s` because callback
formatters feel more natural in TypeScript.

Custom metadata should be explicit and structured:

```ts
defineMetadata({
  custom: [
    meta({ name: "theme-color", content: "#ffffff" }),
    link({ rel: "alternate", hrefLang: "es", href: "/es" }),
  ],
  structuredData: [
    structuredData({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Demiurge",
    }),
  ],
});
```

Metadata resolution should happen before document streaming starts because
titles, canonical links, preload hints, and CSP headers must be known early.
The first metadata slice exposes `defineMetadata(...)`, `meta(...)`, `link(...)`,
`structuredData(...)`, and `resolveMetadata(...)`, then resolves inherited
layout metadata plus the leaf route metadata during route loading. Structured
data renders as escaped JSON-LD and receives the document nonce when one is
available.

## Scripts

Script management should be framework-owned so scripts can be deduped, ordered,
nonced, hoisted, and checked against CSP.

There are two classes of script dependencies.

### Static Route Or Layout Scripts

Known during document planning:

```ts
export const scripts = defineScripts([
  script({
    src: "https://js.stripe.com/v3/",
    strategy: "afterInteractive",
    purpose: "payments",
  }),
]);
```

This can also be conditional if the condition runs before streaming starts:

```ts
export const scripts = defineScripts(({ search }) => {
  if (search.get("checkout") === "true") {
    return [script({ src: "https://js.stripe.com/v3/" })];
  }

  return [];
});
```

Static scripts can participate fully in CSP planning.
The first static script slice exposes `script(...)`, `defineScripts(...)`, and
`resolveScripts(...)`. Page route loading resolves inherited layout scripts
root-to-leaf, then leaf route scripts. Scripts are deduped by source plus
meaningful loading attributes and sorted by loading strategy before document
rendering. Security audits report static document scripts that are missing a
required CSP nonce or are not allowed by the effective `script-src` policy.

The first dependency audit slice adds trust-boundary diagnostics for third-party
script dependencies:

```ts
createSecurityAudit({
  document: {
    policy: security.static(),
    scriptDependencies: {
      requireIntegrity: true,
    },
    scripts,
  },
});
```

`auditScriptDependencies(...)` and the opt-in `scriptDependencies` audit mode
warn about third-party scripts without a declared `purpose`, missing integrity
hashes when required by policy, third-party scripts running
`beforeInteractive`, and Google Tag Manager's wide runtime trust boundary.

### Render-Discovered Scripts

Known only if a component actually renders:

```tsx
function PaymentForm({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return <Script src="https://js.stripe.com/v3/" strategy="afterInteractive" />;
}
```

Inclusion rules:

- In SSR, include it only if that render path renders `<Script />`.
- In streaming SSR, include it when discovered, but it may be too late for head
  placement.
- In client-only rendering, load it when the client component renders.
- In static prerendering, include it if it rendered at build time for that path.
- Duplicate scripts are deduped by `src` plus meaningful attributes.

Headers may already be sent when a render-discovered script appears during
streaming. Therefore late external script origins must already be allowed by
inherited policy:

```ts
export const policy = routePolicy({
  security: {
    needs: {
      script: ["https://js.stripe.com"],
    },
  },
});
```

Then the component decides whether to actually load the script:

```tsx
{showPayment && <Script src="https://js.stripe.com/v3/" />}
```

This separates permission to load from the conditional decision to load.

### Loading Strategies

The 0.1 static-script API intentionally exposes only strategies with behavior
implemented by the document renderer:

```ts
type ScriptStrategy =
  | "beforeInteractive"
  | "afterInteractive"
  | "module";
```

These values define deterministic ordering of static body-end contributions:
`beforeInteractive` first, then `module`, then `afterInteractive`. `module` also
emits `type="module"`. In 0.1, `afterInteractive` is an ordering category; it
does not claim that hydration has completed before the browser evaluates a
classic script. Native `async`, `defer`, and `type` options retain their browser
semantics.

`idle`, `visible`, and `worker` are deliberately absent until the client script
runtime can implement their timing guarantees. JavaScript callers that bypass
the TypeScript union receive an immediate error instead of a silently ordinary
script tag.

If a component requests head placement during streaming after the head has been
sent, the framework should warn or fail and suggest moving the script to
`export const scripts`.

## Document Plan

The framework should collect document contributions from app config, layouts,
route modules, and render-discovered components into a single plan:

```ts
type DocumentPlan = {
  metadata: ResolvedMetadata;
  links: LinkTag[];
  scripts: ScriptTag[];
  styles: StyleTag[];
  preloads: PreloadTag[];
  security: ResolvedSecurityPolicy;
};
```

The document plan is the bridge between DX and strict CSP.
The framework document renderer can render resolved metadata, custom meta/link
tags, resource hints, and static external scripts with HTML escaping. Vite dev
documents for matched page routes feed route/layout metadata, resource hints,
and static script contributions into the renderer.

## Non-Goals For The First Pass

- Solving every third-party script integration.
- Supporting unsafe inline scripts in production presets.
- Supporting strict CSP for arbitrary user-injected raw HTML.
- Turning CORS into an authentication mechanism.

## Research References

- MDN CSP guide, especially nonce guidance and the static HTML tradeoff.
- MDN `script-src` reference for `strict-dynamic`.
- MDN COOP, COEP, and CORP header references for cross-origin isolation.
- OWASP Secure Headers guidance for default header inventory.
