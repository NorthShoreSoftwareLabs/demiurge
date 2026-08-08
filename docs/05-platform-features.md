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
ogImage()
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

### Forms, Actions, And Mutations

Actions should be form-first and secure by default:

```ts
export const POST = action({
  csrf: true,
  input: formData(PostSchema),
  handler,
});
```

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
    nonceInjection: true,
    streaming: true,
    webSocket: true,
  },
});

assertAdapterCapabilities(adapter, ["streaming", "nonceInjection"]);
```

The first adapter slice exposes capability checks for nonce injection,
streaming, WebSocket, WebTransport, cross-origin isolation headers, static
output, and shared cache support. Concrete Node, Edge, and static adapters still
need their own runtime implementations.

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
