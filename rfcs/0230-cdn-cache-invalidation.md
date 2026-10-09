# RFC 0230: CDN cache invalidation and representation controls

## Status

Proposed. This RFC relates to [issue #230](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/230).

## Summary

`CacheStore` keeps application data. A CDN keeps HTTP representations.
These stores have different keys, lifetimes, access rules, and failure modes.

Demiurge keeps their storage contracts separate and coordinates explicit invalidation through a typed deployment integration.
Vercel supplies the first implementation for timed regeneration and path revalidation.
GCP and AWS integrations follow after Vercel conformance verification.

## Context

Route mutations can invalidate `CacheStore` keys and tags after an application
commit. That invalidation removes server data entries. It cannot remove a
representation from a CDN, reverse proxy, browser cache, or another HTTP cache.

A CDN can retain an HTML document, a navigation response, an image response,
or a redirect after the origin data changes. A provider purge can remove that
representation. The purge API belongs to the deployment provider and can have
different scope, authorization, propagation time, quota, and failure behavior.

A data tag does not safely identify a representation. One tag can affect many
routes. One representation can depend on data without declaring a tag. A
provider key can also include host, path, query, request headers, and an
internal provider partition.

## Goals

- Keep data invalidation separate from HTTP representation purging.
- Define safe conditions for a shared representation.
- Define deployment and provider responsibilities for cache control and purge.
- Define failure, stale-response, rollback, and `Vary` rules.

## Non-goals

- Implement GCP or AWS integrations in the first change.
- Add surrogate-key headers or cache-tag headers to framework responses.
- Introduce automatic data-tag mapping or change mutation success rules.
- Make a provider purge transactional with an application commit.
- Define CDN behavior for a provider that does not meet this RFC.

## Terms

Data cache
: A `CacheStore` entry that contains server data or render data.

Representation cache
: A cache entry that contains an HTTP status, headers, and body for a request.

Shared cache
: A representation cache that can serve more than one client.

Purge
: A provider operation that removes or marks representation entries stale.

Freshness lifetime
: The period when a cache can use a representation without validation.

## Decision

### Separate contracts

`CacheStore` tags identify data entries only. `revalidate` invalidates only
the configured `CacheStore`. It emits no client-visible cache or purge header,
calls no CDN API, and changes no representation cache.

Demiurge does not map a data tag to a route, URL, surrogate key, or provider
purge key. The framework cannot prove that such a mapping covers every
representation or has safe scope.

A typed deployment integration owns representation invalidation.
Application routes use an explicit framework operation for path revalidation.
The integration translates that operation into provider requests.
Existing data-tag invalidation retains its current meaning.
A deployment pipeline can also purge mutable representations through the same provider boundary.

### Mutation outcome

A mutation that requests `revalidate` must complete successful data invalidation
before Demiurge returns a successful mutation result. An optional representation
purge must not change that result to a failure.

If a purge starts from a mutation that requests `revalidate`, the integration
must schedule it only after successful data invalidation. If a mutation does
not request `revalidate`, the integration must schedule a purge after the
application commit. A failed purge requires recorded failure state and an explicit retry owner.
Each provider contract must identify the durable mechanism that performs required retries.
Failure handling must not assume that the mutation can roll back an application commit.

An integration can report purge state through application telemetry or an
operator channel. Telemetry must not expose provider credentials, provider
response bodies, cache keys, or internal topology to a client.

### Shared representation eligibility

An operator may place a response in a shared cache only when all conditions
below are true.

- The response has an explicit shared-cache policy.
- The request method is `GET` or `HEAD`.
- The response status is cacheable under HTTP caching rules.
- The response body and headers are identical for all requests with one cache
  key.
- The cache key includes each request header named by `Vary`.
- The response does not depend on a cookie, authorization credential, client
  identity, secret, or anti-CSRF value.
- The response does not contain `Set-Cookie`.
- The CDN preserves the framework security and response headers.

Shared caches must never store authenticated responses. Responses that vary on
`Cookie` are not shared-cacheable. Responses with `private` or `no-store` are
not shared-cacheable.

A response that contains a per-request CSP nonce is not shared-cacheable. A
cached nonce can permit reuse of a security value across clients. Before shared
caching, an operator must use `private, no-store` or a representation without
a per-request nonce.

An application must treat authorization, session state, anti-CSRF values,
personalized metadata, and user-specific redirects as private response inputs.
The application must set a response policy that prevents shared storage.

Public `Origin` or `Sec-Fetch-*` metadata can vary a response. `Vary` must
declare each input, and the shared cache key must include each declared value.

### Vary and cache keys

`Vary` declares response variation by request header. A conforming CDN must
include every declared header value in its cache key. Each cached response must
preserve `Vary` on the stored response and on a cache hit.

If an application changes a response based on a request header, it must declare
that header in `Vary`. A response that varies by a cookie requires `Vary:
Cookie`. Such a response is not eligible for shared caching.

An operator must configure equivalent cache-key behavior for every provider
rule that overrides origin caching. For an unsupported variation, the operator
must disable the shared rule. `Vary: *` prevents reuse by a shared cache.

Query parameters, host, scheme, and path can affect a representation. The
deployment integration must include each relevant input in the provider cache
key. The integration must also purge each matching key when an operator
requires purge.

### Stale representations

`stale-while-revalidate` in `CacheStore` controls data entries only. It does
not configure a CDN or browser cache.

A CDN can serve stale content only when the response cache policy and provider
configuration permit it. The deployment integration owns that policy. The
integration must document the maximum stale period for mutable responses.

Data invalidation does not make a CDN entry stale. A purge can be asynchronous,
and an edge can serve an old representation until purge propagation completes.
An application must tolerate this period or use a shorter freshness lifetime,
a versioned URL, or an application-owned validation method.

The provider must not serve a stale private response to another client. While a
stale entry exists, it must continue to apply the response cache policy and
cache-key rules.

### Purge and rollback

For a static deployment, a pipeline must publish all new immutable assets
before it publishes mutable representations that reference them. Immutable
assets use a content-addressed URL and do not require purge when their bytes
change.

After a mutable representation changes, the pipeline must purge its former
representation. The pipeline must purge all affected variants, including
variants created from `Vary`, host, or query inputs. A path-only purge is
insufficient when the provider stores variants outside that path scope.

A rollback must restore the prior origin representation before it purges the
new representation. The rollback integration must purge the same variant set
as the forward deployment. A rollback does not guarantee that every edge stops
serving the new representation immediately.

If a purge fails, the pipeline must report the failed release or rollback. It
must retain enough release information to retry the exact purge set. Release
management must not delete immutable assets that an older cached page can still
reference.

### Provider and adapter responsibilities

A framework adapter must preserve origin `Cache-Control`, `Vary`, and security
headers unless its documented contract says otherwise. The adapter must not
claim that `CacheStore` invalidation purges a representation cache.

A deployment provider integration owns these actions:

- Authenticate to the provider with a credential that has only required purge
  permissions.
- Define the cache-key and purge-key scope for the deployed application.
- Respect `Cache-Control`, `Vary`, `private`, `no-store`, and `Set-Cookie`.
- Protect provider credentials from browser bundles, logs, and error responses.
- Record a purge request, result, retry state, and affected release.
- State whether a purge removes entries or marks entries stale.
- State the expected purge propagation behavior and provider failure behavior.
- Test forward deployment and rollback with cached mutable representations.

The provider must give the integration a clear success or failure result. If
the provider accepts an asynchronous request, the integration must distinguish
request acceptance from completion.

## Proposed developer interface

API names in this section are provisional. Implementation review must confirm their placement in the existing page and request-context types.

A public page declares its response freshness in its page definition:

```ts
cache: {
  maxAge: 300,
}
```

`maxAge` specifies the shared response freshness lifetime in seconds. It does not configure browser storage or a `CacheStore` lifetime.
An expired response can remain visible during regeneration only within an explicit stale-response limit.
Before implementation starts, issue #230 must define that limit and its Vercel translation before it accepts this declaration.
Caching remains disabled unless the application declares it.

Server application code requests path revalidation after a successful write:

```ts
const result = await context.revalidatePath("/articles/hello");
```

The operation coordinates the generated document and navigation response for the selected path.
The application does not send provider headers or import a provider SDK from a route.
Provider selection remains in deployment configuration.

The result distinguishes provider acceptance, completed regeneration, and failure.
A result reports completion only when the integration has evidence for every required representation.
If the provider cannot prove completion, the result states acceptance.
No result promises immediate visibility at every client or edge.

An invalid path, unavailable capability, or undeclared cache target fails before provider work starts.
An operational provider failure returns a typed result and emits a safe instrumentation signal.
That failure does not change an application write into a failed write.
Applications that require retry can store the result in their durable work system.
The first implementation must identify who owns retry and how failure remains visible.
Request background work cannot supply a durable retry guarantee.

### Data freshness during regeneration

Clearing a response cache can regenerate a page from an unchanged data cache.
Path revalidation must therefore state the data dependencies that it invalidates before regeneration.

The first implementation requires an explicit, inspectable dependency declaration when a page uses cached data.
Dependency discovery must not execute application loaders during static inspection.
Automatic data-tag dependency discovery remains deferred.

Declared data invalidation finishes before the integration requests regeneration.
If data invalidation fails, the operation reports that failure and starts no provider request.
An uncached data loader needs no data invalidation step.
Concurrent writes require a defined ordering rule so an older regeneration cannot replace a newer accepted result.

### Security and diagnostics

The build rejects a shared-cache declaration when its known route policy requires authorization or a per-request CSP nonce.
A runtime check refuses storage when a response contains private inputs, `Set-Cookie`, or incompatible response headers.
Provider routing must prevent a bypass request from changing a private response into a public cache entry.
Mutations and authenticated endpoints remain outside ISR routing.

`demiurge inspect` reports eligibility, freshness, stale limits, declared dependencies, and selected provider capabilities.
Diagnostics identify the source declaration and a repair action.
Development validates the same declarations and executes regeneration through the shared document and navigation pipelines.
Local tests use a deterministic representation cache and a provider test implementation.
Local behavior does not claim to reproduce provider propagation or deployment rollback.

## Vercel implementation boundary

The existing Vercel build integration generates Node functions and hybrid static routes.
ISR adds Prerender Functions and their `.prerender-config.json` files through the Build Output API.
Each declared ISR route receives explicit expiration, cache-key rules, and representation ownership.

During the build, the Vercel integration generates a secret bypass token and keeps it in server artifacts.
It sends an authenticated `GET` or `HEAD` request with `x-prerender-revalidate` to request on-demand regeneration.
A trusted deployment origin supplies the target hostname.
Incoming `Host` headers cannot select the revalidation destination.
Redirects cannot forward the token to another host.

HTML documents and navigation payloads need coordinated invalidation.
The implementation must verify Vercel grouping semantics for both representations before it claims atomic replacement.
If grouping cannot satisfy the contract, it must report partial failure and define a recovery operation.
Query parameters, locale, host, and declared header variation require explicit cache keys and invalidation scope.

Build artifacts must retain the shared route, security, and framework-managed document pipelines.
The integration must preserve explicit `HEAD` handlers, application fallbacks, and unsafe-method ownership.
Regeneration failure retains an eligible prior response only within the declared stale limit.

Vercel documentation defines these primitives:

- [Prerender Functions](https://vercel.com/docs/build-output-api/primitives).
- [On-demand ISR](https://vercel.com/docs/build-output-api/features).
- [ISR lifecycle](https://vercel.com/docs/incremental-static-regeneration).

Live conformance must verify actual provider behavior. Documentation alone does not prove a Demiurge capability.

## Requirements for later provider integrations

These requirements preserve the application interface when another provider becomes available.
They do not authorize GCP or AWS implementation or deployment.

### Common capability contract

Each integration declares support for these operations:

- Timed response caching and regeneration.
- On-demand path invalidation.
- Completion observation and maximum stale lifetime.
- Document and navigation response coordination.
- Host, query, locale, and header variants.
- Shared storage, concurrent regeneration, and request collapsing.
- Deployment rollback and cache namespace isolation.

A provider must not silently ignore an unsupported declaration.
Build or startup validation rejects a known capability mismatch.
Capabilities belong to the selected service combination, rather than the provider name alone.

Provider credentials remain in the server deployment boundary with limited permissions.
Cache and purge keys cannot address another application or deployment.
Instrumentation excludes credentials, secret tokens, internal keys, and provider response bodies.
Retries require idempotent operations, bounded attempts, and an observable terminal failure.

A CDN invalidation does not clear browser caches.
Adapters must preserve the distinction between edge freshness and browser freshness.
Versioned immutable assets remain available while an older response can reference them.

### GCP

A Cloud Run origin can render the replacement response through the Node pipeline.
Cloud CDN supplies response caching and invalidation by host, path, or declared cache tag.
GCP configuration must identify the load balancer, URL map, permissions, and cache-key policy.

CDN removal and origin regeneration are separate operations.
The contract must define their order and the result when one operation fails.
Multiple Cloud Run instances require shared data state and regeneration coordination.
Firebase App Hosting requires a separate capability assessment because it owns a different deployment boundary.

[Cloud CDN invalidation](https://docs.cloud.google.com/cdn/docs/cache-invalidation-overview) documents the provider operation.

### AWS

CloudFront supports path invalidation and background origin refresh through `stale-while-revalidate`.
A Node container or Lambda origin must supply replacement rendering and any shared regeneration state.
AWS configuration must identify the distribution, origin, IAM permissions, cache policy, and invalidation completion state.

Minimum and maximum TTL settings must preserve private-response exclusions and declared stale limits.
Invalidation must cover query variants and any URI rewrite used by the distribution.
Deployment namespaces must prevent an old origin or regeneration job from replacing current content.

Amplify Hosting requires a separate capability assessment.
Its managed Next.js support currently lists on-demand ISR as unsupported.
A CloudFront integration must not inherit Amplify capability claims.

Provider references:

- [CloudFront expiration and stale responses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html).
- [CloudFront invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html).
- [Amplify Next.js capabilities](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html).

## Implementation stages

1. Accept the application API, stale limit, dependency declaration, and failure result contract in issue #230.
2. Add typed capabilities and deterministic local verification.
3. Generate Vercel ISR artifacts and implement on-demand path revalidation.
4. Verify document and navigation consistency on a dedicated Vercel project.
5. Create separate GCP and AWS issues when the roadmap promotes those integrations.

Each implementation stage requires a separate GitHub issue with acceptance criteria.
No implementation starts while its required design decision remains open.

## Rejected alternatives

### Couple `revalidate` to purge

This option makes a mutation result depend on an external provider operation.
The application commit can succeed while a purge fails. Retrying the mutation
can repeat application work and cannot safely repair every representation.

### Add provider-neutral surrogate tags

A generic tag does not define a provider cache key or a safe purge scope.
Different providers apply tags at different layers and have different limits.
The framework would also need to prove that no tag lets a client remove another
application's representation.

### Treat data cache freshness as response freshness

The two caches can have different keys and lifetimes. A data entry can refresh
while a CDN representation remains fresh. A response can also remain cached
after its data entry is invalidated.

## Consequences

Applications keep explicit data and response-cache declarations.
Demiurge coordinates path revalidation through the selected deployment integration.
The integration declares the guarantees that its provider can verify.

The first implementation targets Vercel.
Tag revalidation and additional providers remain deferred until separate issues define their verified behavior.

## Verification plan

When an implementation adds a provider integration, its tests must prove these
conditions.

- Data tag invalidation does not call the provider purge client.
- A configured purge failure does not change a successful mutation result.
- A shared-cache rule rejects a response with `Set-Cookie`, authorization,
  `Cookie` variation, or a per-request nonce.
- A cache key includes all declared `Vary` headers.
- A deployment purge includes every affected variant.
- A rollback restores origin data and requests the matching purge set.

Additional Vercel and local tests must prove these conditions.

- Cached documents and navigation responses represent the same accepted content version.
- Declared data dependencies are invalidated before regeneration starts.
- An older concurrent regeneration cannot replace a newer accepted version.
- Private routes, nonce documents, mutations, and cookie-bearing responses cannot enter ISR storage.
- A bypass token cannot enter browser output, logs, redirects, or an untrusted outbound request.
- Provider failures produce the declared typed result and safe instrumentation.
- Unsupported capabilities fail during build or startup where knowable.
- Inspection reports declarations without executing data loaders.
- Packed consumers use only published package exports.
- `pnpm verify` passes for each implementation change.
