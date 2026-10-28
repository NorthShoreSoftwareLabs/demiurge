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
cached nonce can permit reuse of a security value across clients.
An integration must keep nonce-dependent documents outside every shared target.

Navigation cache hits occurred despite the origin `no-store` header in the isolated proof.
An explicit prerender target can therefore override an intended response exclusion.
Before target generation and cache lookup, an integration must enforce eligibility.
It cannot use that header alone as proof that private output stays outside ISR.
API review must define browser policy and provider storage policy separately.
Unexpected private generation output requires a verified publication exclusion before public implementation.

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
integration must document its stale-serving mode for mutable responses.
A bounded mode states the maximum stale period that the provider can enforce.
A provider-managed mode explicitly states that the framework supplies no maximum stale period.

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

## Developer interface direction

The public interface remains provisional until the Vercel proof establishes the required behavior.
This RFC selects a provider boundary and acceptance conditions. It does not select final page fields or result types.

A page explicitly enables shared response caching and states a refresh interval.
Server application code can request path invalidation after a successful write.
Provider selection remains in deployment configuration.
Application routes do not construct provider requests or import provider SDKs.

The proposed interval name is `refreshAfter`.
This interval describes request-driven regeneration eligibility.
Content age, browser lifetime, and data-cache lifetime remain separate concepts.
Caching requires explicit consent to stale serving after regeneration failure.
No public strict stale-age field or completion result is added without an implementation that can enforce it.

Omitted response-cache declarations generate no ISR target.
The implementation must preserve the existing route and security header contracts when ISR is disabled.
Disabled ISR must preserve response headers under the existing security contract.

### Provider-managed stale serving

Vercel Prerender Functions expose an `expiration` interval.
A positive refresh interval maps to that field.
The first integration does not use indefinite freshness through `expiration: false`.

Vercel regenerates expired responses in the background and retains prior content after regeneration failure.
Its documented failure behavior uses a 30-second retry TTL. This interval does not bound total stale age.
The Build Output API exposes no maximum stale-age field in its Prerender Function configuration.

The first integration must therefore state that it supplies no maximum stale age.
An application that requires a strict content-age limit cannot select this mode.
Inspection and diagnostics must explain that limitation before deployment.
The final consent field requires API review after the proof.

### Data freshness during generation

Timed regeneration and explicit path invalidation must both produce data under a documented freshness rule.
Deleting only a response entry can reproduce old content from the data cache.
Freshness probes must exercise cached data during both regeneration paths.

The framework must establish a fresh generation context without duplicating every loader dependency in the page declaration.
A candidate generation context bypasses shared data-cache reads during generation while retaining request-local deduplication.
The investigation must define whether generation writes shared data entries and how those writes interact with concurrent invalidation.
Each local candidate generation starts with an empty disposable store.
It retains request-local deduplication and makes no writes to the ordinary shared store.
This isolates candidate generation from concurrent invalidation of that store.
Accepted data-cache behavior remains unchanged by this proof.
Independent page, layout, metadata, and document probes remain required before this becomes a public contract.

Existing key and tag declarations remain the source for ordinary data invalidation.
Page, layout, metadata, and document data all require the selected generation rule.
External caches remain application-owned and require a documented freshness responsibility.

A bounded proof must test dynamic route keys and concurrent data refresh.
If the candidate cannot provide the required freshness, the proof must report the missing mechanism before API acceptance.
Literal page dependency inventories and automatic dependency discovery are outside the first public interface.
Automatic representation-tag mapping remains deferred.

### Invalidation result and retries

The initial operation reports provider acknowledgment or an operational failure.
It must not report completed regeneration without evidence for every required representation.
A transport timeout can leave provider acceptance unknown.
The result must distinguish an unacknowledged operation from proof that the provider performed no work.
Final result fields follow the observed provider protocol.

Configuration errors fail before provider work starts where the framework can identify them.
Operational failures emit safe application-owned instrumentation with an opaque correlation identifier.
No result contains credentials, internal cache keys, or provider response bodies.
A failed invalidation does not reverse a committed application write.

The framework supplies no durable retry queue.
Vercel owns the regeneration retries that its ISR service accepts.
Applications own durable delivery of explicit invalidation requests when their product requires that guarantee.
An application can record an invalidation job with its committed write.
Retries must be safe when a prior request succeeded but its acknowledgment was lost.
Request background work cannot supply a durable retry guarantee.

### Request handling on cache hits

A provider cache hit can bypass the origin route pipeline.
Generation-time checks alone cannot enforce middleware behavior for each later request.
Request probes must identify which route behavior runs during generation and which behavior must run for every request.

Routes that require per-request authorization, session changes, rate limiting, or response headers cannot silently lose that behavior through ISR.
Vercel route validation rejects such routes unless a verified request boundary preserves their contract.
A public access declaration alone does not prove response-cache eligibility.

[ADR 0025](../architecture/decisions/0025-host-middleware-integration-boundary.md) retains application middleware in the shared route pipeline.
Provider guard code validates deployment inputs and imports no application middleware.
It does not provide an accepted extension for moving application behavior before cache lookup.
A route that needs application middleware on every request remains ineligible under the current decision.

Personalized responses, cookie changes, mutations, and per-request CSP nonces remain outside shared ISR storage.
Generation must prevent arbitrary incoming cookies and headers from influencing a stored public response.
Declared public variants need explicit cache keys and controlled generation inputs.

Tests must exercise cache hits as well as cache misses.
They must prove that one client cannot populate a response that exposes another client's data.
A bypass request cannot change a private response into a public cache entry.

### Document and navigation behavior

Document requests and browser navigation use the same application route and data contracts.
The current integration distinguishes navigation requests through `x-demiurge-navigation`.
Representation probes must establish separate provider cache identities for document and navigation responses.
An untrusted header must not select another representation's cache entry.

Vercel grouping revalidates related assets together.
That fact does not prove that separate function executions read the same data snapshot or replace their entries atomically.
Concurrency probes must observe mixed versions during concurrent updates and failed regeneration.

The investigation first evaluates a shared generation result for both representations.
If Vercel requires separate generation, the accepted contract must state the observed consistency limits.
It must not describe grouping alone as atomic replacement.
Applications that require immediate authoritative reads retain uncached request handling.

### Inspection and local verification

`demiurge inspect` reports eligibility, refresh behavior, stale-serving limits, and provider capabilities.
Diagnostics identify the source declaration and a repair action.
Inspection does not import route modules or execute loaders.

Development validates the same declarations and uses the shared document and navigation pipelines.
A deterministic local provider implementation verifies operation order and failure handling.
Local tests do not prove provider propagation, cache grouping, or deployment rollback.

## Required Vercel proof

[Issue #481](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/481) owns this bounded investigation.
The [local investigation record](../docs/maintainers/vercel-isr-investigation.md) separates local evidence from required live provider proof.

The proof uses one public route with versioned data and one private control route.
It exercises production artifacts through published package boundaries.
A private investigation harness can test provider primitives before the public API is accepted.
Provisional public exports and changes to existing application behavior remain outside the investigation.

The verification record must include these results:

- Timed regeneration observes the selected fresh-data rule after a cached data entry becomes stale.
- Explicit invalidation observes the same fresh-data rule after an application write.
- Document and navigation entries have separate cache identities and a documented consistency relationship.
- Cookie, authorization, navigation-header, and query manipulation cannot populate private data in a shared entry.
- Cache hits preserve required request behavior or make the route ineligible.
- Failed regeneration demonstrates the provider's actual stale-serving and retry behavior.
- Lost acknowledgments and repeated invalidation requests produce the documented failure and retry semantics.
- Concurrent refresh and deployment rollback do not receive unsupported ordering or completion guarantees.

The record identifies artifact commits, provider configuration, requests, responses, and observed limitations.
Live probes require separate authorization for a dedicated verification project.
This RFC does not authorize deployment or provide that access.

API acceptance follows the proof record.
If the proof fails a required condition, the proposal must change before public implementation starts.

## Evidence applied to this proposal

An [October 17 isolated proof](../docs/maintainers/vercel-isr-isolated-proof.md) supersedes the rejected October 15 routing candidate.
Main commit `c5881c646cd902b7236704f2dc56d945f78b03ea` records that proof through PR #485.
A [request record](../docs/maintainers/evidence/vercel-isr-2026-10-17.json) identifies committed fixture sources, artifact hashes, provider configuration, and redacted observations.
Its source commit differs from the later record merge commit.
Merged verification passed `pnpm verify` and the Node 22.13 package contract.

These observations constrain the proposal.
They do not accept its public API.

| Boundary | Observed evidence | Proposal constraint |
| --- | --- | --- |
| Representation identity | Both warming orders retain separate HTML and JSON cache hits. | Include explicit representation identity in the provider key. Reject a client-supplied reserved identity before lookup. |
| Request checks | Guard markers change while generation and origin markers remain unchanged on hits. | Validate eligible deployment inputs before lookup. Keep per-request application middleware routes ineligible. |
| Hostile inputs | Cold and populated entries reject tested cookies, authorization, unknown or repeated query names, and invalid navigation markers. | Admit only declared inputs. Keep unsupported request variants outside shared targets. |
| Fresh generation | Timed refresh reaches version 2. Explicit refresh reaches version 3. | Use the documented disposable generation context. Verify every framework data contribution before implementation acceptance. |
| Consistency | Concurrent HTML and JSON generations retain versions 5 and 6. | Permit independently published versions. Claim no atomic replacement or shared source snapshot. |
| Failure and recovery | Failed regeneration returns 500 while public requests retain version 3. Later recovery reaches version 4. | Require explicit provider-managed stale consent. Promise no maximum stale age or exact retry interval. |
| Unknown acknowledgment | Origin work starts before timeout confirmation. Authenticated retry restores public version 7. | Report unknown acceptance after transport failure. Keep retry safe and distinguish acknowledgment from observed publication. |
| Private output | Artifact configuration excludes private and nonce controls. An explicit navigation target caches output despite `no-store`. | Verify target admission and publication exclusions. Do not infer them from origin headers alone. |

Recorded observations cover one configured region and the tested request variants.
This evidence establishes no global propagation deadline, all-variant completion result, or durable invalidation delivery.
Fixture results do not prove browser hydration, arbitrary `Vary`, external stores, or independent metadata and layout freshness.
Deployment replacement and rollback remain unobserved.

### Remaining acceptance work

Issue #481 remains open.
Its investigation must identify each unproved condition before owner review of this RFC.
Acceptance retains these requirements.

- Verify generation freshness for page, layout, metadata, and document contributions through the shared pipeline.
- Define the supported variant set and reject every unsupported declared variant before deployment.
- Verify direct target access and private publication exclusions for the proposed production artifact.
- Observe deployment replacement and rollback before claiming their cache scope or ordering behavior.
- Verify browser navigation against the proposed cacheable production artifact.
- Retain explicit limits for global propagation, external data stores, and regeneration retry timing.
- Obtain owner acceptance of the evidence and resulting public contract in issue #230.

A saved-record assessment cannot replace a missing live observation.
New live probes require authorization for their dedicated verification deployment.
Until an accepted implementation changes it, the public adapter retains its current uncached behavior.

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
Observed grouping behavior does not provide atomic replacement for both representations.
An initial integration must document independently published versions.
A stronger guarantee requires separate evidence and design acceptance.
The proof determines the consistency contract and recovery behavior before the public operation is implemented.
Query parameters, locale, host, and declared header variation require explicit cache keys and invalidation scope.

Build artifacts must retain the shared route, security, and framework-managed document pipelines.
The integration must preserve explicit `HEAD` handlers, application fallbacks, and unsafe-method ownership.
Regeneration failure can retain an eligible prior response under an explicitly selected provider-managed policy.
The first Vercel integration declares that it cannot enforce a maximum stale age.

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

1. Complete the bounded Vercel investigation in issue #481.
2. Verify fresh generation, cache-hit security, representation identity, and failure behavior.
3. Review the proof record and accept the smallest supported public contract in issue #230.
4. Implement that contract with typed capabilities, local tests, and packed-consumer verification.
5. Create separate GCP and AWS issues when the roadmap promotes those integrations.

Each implementation stage requires a separate GitHub issue with acceptance criteria.
The bounded investigation can precede API acceptance.
Public implementation requires the accepted design decision.

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

Applications retain existing data declarations and explicitly select response caching.
The proposed path operation belongs to the selected deployment integration.
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

Additional implementation tests must verify the accepted proof contract.

- Document and navigation cache identities cannot collide.
- Both regeneration paths use the accepted fresh-data rule.
- Cache hits preserve required request behavior or reject the route declaration.
- Provider acknowledgment does not produce an unsupported completion claim.
- Unknown provider acceptance remains visible after a transport failure.
- Private routes, nonce documents, mutations, and cookie-bearing responses cannot enter ISR storage.
- A bypass token cannot enter browser output, logs, redirects, or an untrusted outbound request.
- Unsupported capabilities fail during build or startup where knowable.
- Inspection reports declarations without executing data loaders.
- Packed consumers use only published package exports.
- `pnpm verify` passes for each implementation change.
