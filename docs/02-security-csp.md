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
```

Optional, deployment-dependent headers:

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Embedder-Policy: require-corp
Origin-Agent-Cluster: ?1
```

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

Streaming SSR needs nonce support for every framework-emitted script chunk.
React's renderer supports nonce-style script emission in modern server rendering
APIs, but the framework needs to own the nonce and pass it into the renderer
instead of relying on user components to remember it.

Open design question:

- Can we avoid inline streaming scripts entirely for some modes?
- If not, can every emitted script be nonce-backed?
- How do third-party scripts join the policy without weakening it?

### React Server Components

RSC Flight payloads should be treated as data streams, not executable inline
scripts. The safest direction is:

1. Serve Flight over a dedicated `Content-Type`.
2. Fetch it as data from the client runtime.
3. Keep executable bootstrap code in nonce-backed external scripts.
4. Avoid embedding changing Flight chunks into inline scripts that would require
   impossible CSP hashes.

Open design question:

- For initial document responses that include RSC data, should the framework use
  a nonce-backed script tag, a non-executable JSON script tag, or a separate
  fetch?

### Partial Prerendering

Partial prerendering is where strict CSP can get slippery:

- The static shell wants hash-based CSP.
- The dynamic holes may need nonce-based streamed content.
- If dynamic content is delivered as inline scripts, static hashes will not
  match.

Potential framework rule:

```ts
react({
  prerender: "shell",
  dynamic: "stream",
  csp: "nonce-at-edge",
});
```

This would require a server or edge adapter that can generate a nonce, patch the
shell, and stream the dynamic tail. If there is no runtime that can inject a
fresh nonce, the framework should fail the build or choose a no-inline-data
strategy.

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
capability with CORS policy. Wildcard origins with credentials fail closed.

## CSRF

Cookie-authenticated unsafe methods should get CSRF protection by default.

```ts
export const POST = action({
  csrf: true,
  input: formData(UpdateProfileSchema),
  handler,
});
```

Framework responsibilities:

- Default CSRF protection for cookie-authenticated `POST`, `PUT`, `PATCH`, and
  `DELETE` actions.
- Exempt verified webhooks and explicit tokenless API routes only through typed
  route policy.
- Support progressive enhancement for forms.
- Make same-site cookie settings visible in security audit output.

The first CSRF slice supports explicit helper-attached validation:

```ts
export const POST = text(({ request }) => request.text(), {
  security: {
    csrf: true,
  },
});
```

Unsafe methods protected with `csrf: true` require the default
`csrf-token` cookie to match the `x-csrf-token` request header. Routes can
override both names:

```ts
csrf: {
  cookie: "demo-csrf",
  header: "x-demo-csrf",
}
```

CSRF failures occur before the route handler reads the body and preserve CORS
headers when the route also has CORS policy.

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
and enforces declared `Content-Length` against an optional `maxBodySize`.

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
Malformed declared lengths on limited routes fail with `400`.
Route-level `allowedMethods` additionally returns `405` before the handler runs
when a route capability exists but policy disallows that method. `HEAD` is
allowed when `GET` is allowed.

The first rate-limit slice adds fixed-window helper-attached limits. The default
server handler uses a per-handler memory store; production adapters can provide
a shared store through `createRequestHandler({ rateLimitStore, routes })`.
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
  handler: async ({ rawBody }) => {
    return Response.json({ received: rawBody.length });
  },
});
```

The helper reads and preserves the raw body, verifies the configured signature
header before the app handler runs, and marks CSRF disabled for the verified
webhook route. Provider-specific helpers can build on this primitive.

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

Framework responsibilities:

- Generate `Trusted-Types` and `require-trusted-types-for` headers.
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

Initial strategies:

```ts
type ScriptStrategy =
  | "beforeInteractive"
  | "afterInteractive"
  | "idle"
  | "visible"
  | "worker";
```

Strategy should imply placement by default:

- `beforeInteractive`: hoisted early.
- `afterInteractive`: after framework runtime/hydration.
- `idle`: scheduled after the page settles.
- `visible`: loaded when the owning component or island becomes visible.
- `worker`: future worker/off-main-thread loading strategy.

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
