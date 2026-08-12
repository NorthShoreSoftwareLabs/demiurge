# Platform Features And Integrations

Demiurge should provide first-class support for framework features that affect
document output, security, rendering, caching, routing, or deployment behavior.
Everything else can be an integration package, but the integration system should
still feed the same typed policies and audit tools.

## Core Surfaces

### Security

Security should be core:

```ts
security.strict()
security.crossOriginIsolated()
security.csrf()
security.rateLimit()
security.requestSizeLimit()
security.allowedMethods()
security.basicAuth()
security.audit()
```

Core security features:

- Strict CSP with nonce/hash/auto modes.
- Typed CORS.
- CSRF for cookie-authenticated unsafe methods.
- Rate limiting.
- Request size limits.
- Upload limits.
- Security headers.
- WebSocket origin checks.
- Webhook verification.
- Trusted Types opt-in/report-only/enforce modes.
- Built-in security report endpoint.
- Build/runtime audit output.

The first report endpoint slice exposes `createSecurityReportHandler(...)` for
collecting CSP and Reporting API payloads through ordinary route capabilities.

### Metadata And SEO

Metadata should be structured and cascading:

```ts
defineMetadata({
  title: {
    default: "Demiurge",
    format: (title) => `${title} | Demiurge`,
  },
  description: "A tiny React framework built from first principles.",
  canonical: "/",
  openGraph: {
    title: "Demiurge",
    image: "/og.png",
  },
});
```

Core SEO helpers:

```ts
defineMetadata()
defineSitemap()
defineRobots()
defineOgImage()
canonical()
alternates()
structuredData()
```

The first structured data slice supports JSON-LD entries inside route/layout
metadata:

```ts
defineMetadata({
  structuredData: [
    structuredData({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "File based routing",
    }),
  ],
});
```

Resolved document output emits these entries as escaped
`application/ld+json` scripts and applies the document nonce when one is
available.

The first sitemap/robots slice supports typed standalone SEO outputs:

```ts
const sitemap = defineSitemap([
  {
    url: "https://example.com/blog/file-routing",
    lastModified: "2026-01-02",
    changeFrequency: "weekly",
    priority: 0.8,
  },
]);

const robots = defineRobots({
  rules: [{ userAgent: "*", allow: "/", disallow: "/admin" }],
  sitemap: "https://example.com/sitemap.xml",
});
```

`renderSitemap(...)` emits escaped sitemap XML, and `renderRobots(...)` emits
`robots.txt` content. Static and server adapters still need to wire these
helpers into generated `/sitemap.xml` and `/robots.txt` outputs.

The first OG image slice supports deterministic SVG output:

```ts
const image = defineOgImage({
  brand: "Demiurge",
  title: "File based routing",
  subtitle: "Typed URLs with strict security defaults",
});

export const GET = response(renderOgImageResponse(image));
```

`renderOgImageSvg(...)` escapes text and validates dimensions, while
`renderOgImageResponse(...)` returns a cacheable `image/svg+xml` response.
Raster image rendering can build on this API later.

The framework should emit default charset and viewport metadata unless the app
intentionally overrides them.

### Scripts And Third-Party Integrations

Scripts should be managed document contributions:

```ts
export const scripts = defineScripts([
  script({
    src: "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX",
    strategy: "afterInteractive",
    purpose: "analytics",
  }),
]);
```

For common third parties, prefer typed integrations over copied snippets:

```ts
integrations.gtm({
  id: "GTM-XXXX",
  consent: "required",
});

integrations.ga4({
  id: "G-XXXX",
  strategy: "afterInteractive",
});

integrations.plausible(...);
integrations.posthog(...);
integrations.sentry(...);
```

Integration packages should declare:

- Required CSP directives.
- Required CORS/connect permissions.
- Whether inline bootstrap is required.
- Script loading strategy.
- Consent requirements.
- Trusted Types compatibility.
- Whether the integration can run in strict CSP without `unsafe-inline` or
  `unsafe-eval`.

For 0.1, static script contributions support `beforeInteractive`, `module`, and
`afterInteractive` as deterministic ordering categories. Deferred-until-idle,
visibility-triggered, and worker execution remain future client-runtime work;
they are not accepted as inert configuration values.

The framework should not silently weaken CSP when a third-party integration is
added. It should either merge declared needs or produce an actionable diagnostic.

### Analytics

Analytics should be privacy/security aware:

```ts
analytics.provider("plausible", {
  domain: "example.com",
  consent: false,
});
```

The first analytics slice provides `analytics.plausible(...)`. It produces a
managed script descriptor, the required `connect-src` origin, and explicit
consent metadata. Custom endpoints must use HTTPS; event and route-transition
delivery remains application-owned through the instrumentation API.

First-class concerns:

- Core Web Vitals reporting.
- Route transition events.
- Server timing.
- Consent-gated analytics.
- CSP-aware script loading.
- No raw GTM snippets as the preferred path.

The first server timing slice lets route response helpers attach framework-owned
`Server-Timing` entries:

```ts
export const GET = json(
  { ok: true },
  {
    timing: serverTiming(
      { name: "db", duration: 12.5, description: "database" },
      { name: "cache" },
    ),
  },
);
```

The request handler and Vite dev server append these metrics to response
headers, preserving existing app-provided `Server-Timing` values on raw
responses.

GTM should be supported, but it is inherently broad because it can load other
scripts. The first dependency audit slice labels Google Tag Manager as a wide
trust boundary and warns about third-party scripts that lack declared purposes,
required integrity hashes, or early `beforeInteractive` execution.

### Images

Image optimization is core because it affects performance, security policy, and
deployment adapters.

```tsx
<Image
  src={post.hero}
  alt={post.title}
  width={1200}
  height={630}
  priority
/>
```

Core image features:

- Responsive `srcset`.
- Required or inferred dimensions to prevent layout shift.
- Lazy loading by default.
- Priority images for above-the-fold content.
- Modern formats such as AVIF/WebP where supported.
- Remote image allowlists.
- Signed/proxied image optimizer route.
- Static build image generation.
- Adapter-aware optimization.
- CSP `img-src` diagnostics.

Remote images should require explicit allowlists:

```ts
defineImages({
  remote: [
    "https://images.example.com",
  ],
});
```

The first image slice provides adapter-independent validation and transform
planning:

```ts
const plan = planImageTransform(
  {
    src: post.hero,
    alt: post.title,
    width: 1200,
    height: 630,
    sizes: "(min-width: 900px) 900px, 100vw",
    priority: true,
  },
  defineImages({
    remote: ["https://images.example.com"],
  }),
);
```

The planner validates local and remote image sources, requires explicit remote
allowlists, creates deterministic optimizer URLs and `srcset` variants, and
sets loading/fetch-priority attributes. The actual `<Image>` component,
optimizer route, and static image generation remain adapter work.

### Fonts

Fonts are performance and privacy/security relevant. Prefer self-hosting.

```ts
export const fonts = defineFonts([
  font.google({
    family: "Inter",
    selfHost: true,
  }),
  font.local({
    name: "Brand",
    src: "./assets/brand.woff2",
  }),
]);
```

Core font features:

- Self-host Google fonts by default.
- Generate preload hints.
- Avoid layout shift.
- Feed `font-src` policy.
- Avoid runtime third-party font requests unless explicitly configured.

The first font slice provides `defineFonts(...)`, `font.local(...)`,
`font.google(...)`, `fontPreloadLinks(...)`, and `renderFontFaceCss(...)`.
Local descriptors render deterministic `@font-face` CSS and preload links.
Google descriptors preserve self-host intent for a build adapter; they do not
silently add runtime requests.

### Resource Hints

Resource hints should be structured:

```ts
export const links = defineLinks([
  preconnect("https://api.example.com"),
  preload("/hero.avif", { as: "image" }),
  modulePreload("/assets/editor.js"),
]);
```

These must flow through the document plan and security audit.
The first resource hint slice exposes `defineLinks(...)`, `preconnect(...)`,
`preload(...)`, `modulePreload(...)`, and `resolveLinks(...)`. Page route
loading resolves inherited layout links root-to-leaf, then leaf route links,
with dedupe and deterministic hint ordering before document rendering.

### Observability

Observability should be adapter-aware and OpenTelemetry-friendly:

```ts
instrumentation.request(...)
instrumentation.serverStart(...)
instrumentation.trace(...)
reportWebVitals(...)
```

The first observability slice provides `defineInstrumentation(...)`. Today it is
a typed event dispatcher application code can call; the request handler, Node
adapter, renderer, cache, and action pipeline do not automatically emit through
it yet. It must not be described as complete framework instrumentation until
those runtime paths are wired.

Instrumentation and a telemetry backend are separate concerns. Core should
measure lifecycle operations and propagate W3C trace context. An optional
OpenTelemetry integration should turn those signals into active spans and
metrics with async context. Datadog, Honeycomb, and similar systems can consume
OTLP; vendor-specific adapters are reserved for capabilities the portable path
cannot express. The callback dispatcher remains useful for lightweight logs and
tests without an OpenTelemetry dependency.

Core signals:

- Request traces.
- Route timing.
- Render timing.
- Cache hit/miss events.
- Action timing and failures.
- Security report ingestion.
- CSP/Trusted Types violation reporting.
- Core Web Vitals.
- Server-Timing headers.

Automatic request/server/render/cache/action signals, `traceparent`
propagation, active-span context, metrics, and log correlation are roadmap work.

### Forms, Actions, And Mutations

Actions should be form-first and secure by default:

```ts
export const POST = action({
  csrf: true,
  input: formData(PostSchema),
  handler,
});
```

The first action slice provides server-side `action(...)` and `actionInput`
helpers. It parses JSON, form data, or text input, lets handlers return existing
response helpers, and composes with idempotency stores for retry-safe mutations.

Core concerns:

- Progressive enhancement.
- CSRF.
- Idempotency.
- Validation.
- Typed errors.
- Redirects.
- Cache invalidation.
- Optimistic client UI.

### Uploads

Upload support should include:

- Streaming multipart parsing.
- Body and file size limits.
- MIME/type validation.
- Presigned direct-to-storage helpers.
- Adapter capability checks.
- Optional scanning hooks later.

The first upload limits slice exposes `validateUploads(...)` for parsed
`FormData`. It validates required file fields, per-file sizes, aggregate upload
size, and allowed MIME types before app code persists or processes uploaded
files.

### Headers, Redirects, And Rewrites

Support app-level and route-level redirects/rewrites/headers, while steering
security headers through typed policy APIs.

```ts
export const redirects = defineRedirects([...]);
export const rewrites = defineRewrites([...]);
export const headers = defineHeaders([...]);
```

Security-sensitive headers should prefer:

```ts
routePolicy({
  security: { ... },
});
```

### Adapter Capabilities

Adapters should declare what deployment features they support:

```ts
const adapter = defineAdapter({
  name: "node",
  capabilities: {
    backgroundLifetime: true,
    nonceInjection: true,
    streaming: true,
    webSocket: true,
  },
});

assertAdapterCapabilities(adapter, ["streaming", "nonceInjection"]);
```

The adapter contract exposes capability checks for background lifetime, nonce
injection, streaming, WebSocket, WebTransport, cross-origin isolation headers,
static output, and shared cache support. Concrete Node and static adapters now
exercise that contract; an Edge adapter and shared cache implementations remain.

### Devtools And Audits

Demiurge should expose a route audit view:

```txt
/checkout
  render: ssr streaming
  layouts: root -> checkout
  middleware: root -> auth
  CSP: nonce strict
  Trusted Types: report-only
  scripts: Stripe
  cache: public tags checkout
  images: remote images.example.com
```

Command-line audit:

```sh
demiurge audit
demiurge audit security
demiurge audit route /checkout
```

Audit output should show inherited policy and explain why each permission exists.

### Future Feature Flags And Experiments

Feature flags and A/B tests should use a small core contract plus optional
provider integrations. Core should own typed flag definitions and result
shapes, deterministic request-stable assignment, explicit evaluation context,
SSR-to-hydration consistency, test overrides, cache-partition checks, and an
exposure-event contract. Vendor packages should own LaunchDarkly, Statsig,
GrowthBook, Unleash, Edge Config, and similar SDK setup, credentials, retries,
streaming updates, and provider-specific limits.

Experiment assignment is not a generic cache lookup. It needs a declared sticky
identity or anonymous assignment cookie, deterministic bucketing, and exposure
recording only when a variant is actually rendered. A public cached result must
either include the variant in its key or be rejected; otherwise one user's
assignment can leak to everyone. The server-selected variant and bootstrap data
must agree so hydration never re-buckets the visitor. Provider adapters may
supply evaluation and event delivery, but must not redefine those core
correctness rules.

This is future work and is not part of the 0.1.0 surface.

## Integration Territory

These should be easy to add through typed integrations, but do not all need to
live in core:

- GTM, GA4, Plausible, PostHog, Segment.
- Sentry, Datadog, Honeycomb.
- Stripe, Clerk, Auth0.
- CMS integrations.
- MDX, Markdoc, content collections.
- Sitemap submission and search indexing.
- Email providers.
- Database adapters.
- Deployment adapters.
- Feature-flag and experimentation providers.

Integrations should feed core primitives instead of bypassing them.

## Prior Art

- Next.js has first-class metadata, OG image generation, image optimization,
  font optimization, script loading strategies, production security guidance,
  OpenTelemetry/instrumentation, and web vitals reporting.
- Nuxt has Unhead-based SEO/head management, image/font/modules ecosystem,
  Nuxt DevTools route visibility, and a popular `nuxt-security` module covering
  headers, CSP, CORS, rate limits, request limits, allowed methods, basic auth,
  and CSRF.
- Astro has middleware, hybrid rendering, image support, server islands, actions,
  CSP configuration, and integrations.
- SvelteKit has CSP modes including hash/nonce/auto, CSRF config, load/actions,
  prerender entries, and adapters.
