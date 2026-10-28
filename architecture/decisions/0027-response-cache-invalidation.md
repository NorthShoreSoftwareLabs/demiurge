# ADR 0027: Response Cache Invalidation

## Status

Accepted.

The repository owner authorized this decision on October 27, 2026.
The October 28 completion proof supplies the required bounded provider evidence.

Tracking: [GitHub issue #230](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/230).
Provider investigation: [GitHub issue #481](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/481).

## Context

`CacheStore` holds application data.
A provider response cache holds an HTTP status, headers, and body.
These stores have different keys, lifetimes, access rules, and failure modes.
Data invalidation cannot remove a response from a provider or browser cache.

Vercel Prerender Functions can skip origin execution on cache hits.
Explicit prerender configuration can cache navigation output despite its origin `no-store` header.
Response headers alone cannot establish storage exclusion under that configuration.

The October 17 investigation separated document and navigation cache identities.
Concurrent generation produced different data versions for those representations.
A failed regeneration retained stale output.
A lost acknowledgment left provider acceptance unknown.
These results require explicit eligibility, consistency, and failure boundaries.

## Decision

### Separate storage and invalidation

`CacheStore` keys and tags identify data entries only.
Existing `revalidate` behavior invalidates the configured data store.
It calls no provider purge API and emits no representation invalidation header.

A typed deployment integration owns response caching and path invalidation.
Application server code uses an explicit framework operation after a successful write.
Provider selection remains in deployment configuration.
Routes do not construct authenticated provider requests.

Data tags do not automatically map to response paths or surrogate keys.
An invalidation request identifies a concrete application path and its supported variants.
Unknown paths, unsupported variants, and invalid configuration fail before provider work starts when knowable.

### Initial provider scope

Vercel Node Functions are the first response-cache target.
The initial contract permits timed regeneration and explicit path invalidation.
GCP, AWS, provider-neutral surrogate tags, and automatic dependency discovery remain outside this decision.

Omitted response-cache declarations generate no prerender target.
Existing uncached behavior remains unchanged until a separate implementation issue adds the accepted contract.
This decision exports no public API or result type.

A page must explicitly enable response caching and select a positive refresh interval.
The interval means request-driven regeneration eligibility.
It does not define browser lifetime, data-cache lifetime, or a maximum content age.

An application must explicitly accept provider-managed stale serving.
The first Vercel integration promises no maximum stale age or exact regeneration retry interval.
An application that requires either guarantee must use uncached handling.
Inspection must report these limits before deployment.

### Eligibility and request validation

Only explicitly public, deterministic representations can enter shared storage.
The route declaration must describe all supported generation inputs.
Public access alone does not establish response-cache eligibility.
Applications remain responsible for the public data they return.

The first integration admits these input classes:

- A concrete matched pathname with its declared route parameters.
- An explicit locale represented in that pathname.
- An allowlist of query names with one value per name.
- One framework-owned document or navigation representation identity.
- One framework-owned deployment cache namespace.

Each admitted input must participate in the provider cache key.
Unknown query names, duplicate values, and client-supplied reserved identities fail before cache lookup.
Other incoming headers cannot influence public generation.
Only the validated representation marker survives as a controlled framework input.

Arbitrary header variation remains unsupported by the first integration.
A declaration that requires another `Vary` input fails before deployment.
`Vary: Cookie` and `Vary: *` always prevent shared response caching.

Credential-bearing requests cannot enter a shared target.
Cookies, authorization credentials, client identities, secrets, and anti-CSRF values cannot influence public generation.
Private routes and per-request nonce documents receive no prerender configuration.
Unsafe methods continue through uncached framework handling.

Application middleware remains in the shared route pipeline under ADR 0025.
A route that requires application middleware on each request remains ineligible.
The same rule applies to per-request authorization, rate limits, session changes, and response headers.
Provider guards validate deployment inputs and import no application middleware.

Origin responses with unexpected private output must not reach shared publication.
This includes `Set-Cookie`, private response policy, and nonce-dependent output.
The implementation must reject a known violation during build or startup.
Runtime generation must fail before publication when static inspection cannot establish eligibility.
A provider header override cannot remove this requirement.

Browser policy and provider storage policy are separate contracts.
The implementation must preserve the accepted browser policy without relying on that policy to prevent provider storage.
A cacheable navigation response can retain the framework browser `no-store` policy under its explicit response-cache declaration.
That exception does not permit private output or credential-dependent generation.
A route that cannot meet both contracts remains ineligible.

### Fresh generation

Timed and explicit regeneration use one fresh generation rule.
Each generation starts with an empty disposable framework data store.
It bypasses ordinary shared data-cache reads and retains request-local deduplication.
Generation writes affect only the disposable store.
A concurrent ordinary invalidation therefore cannot receive a later generation write into its shared store.

Page, layout, metadata, and framework-managed document contributions use this generation context.
The application does not duplicate loader dependency inventories in a page declaration.
Ordinary requests retain existing data keys, tags, and store behavior.

External data caches remain application-owned.
Applications must provide authoritative external reads when their product requires current external data during generation.
The framework supplies no transaction or shared snapshot across external services.

### Representation identity and consistency

Documents and navigation payloads use separate provider cache identities.
The integration validates the original request before provider lookup.
A reserved provider query can carry the representation identity after that validation.
Generation removes that internal query before it enters the shared route pipeline.

Both representations use the same route, document, data, security, and navigation contracts.
Each representation can publish independently and retain a different source version.
Provider grouping supplies no atomic replacement or shared source snapshot guarantee.
A successful invalidation acknowledgment does not prove publication of every representation.

Concurrent regeneration and failed regeneration can leave mixed versions visible.
Applications that require immediate authoritative reads must use uncached handling.
The framework supplies no global propagation deadline.

### Invalidation results and failures

An invalidation result distinguishes acknowledgment, rejection, and unknown acceptance.
A transport timeout or lost response can leave acceptance unknown after provider work starts.
Provider acknowledgment never means global completion or durable delivery.

Retries must tolerate an earlier accepted request whose acknowledgment was lost.
The operation cannot repeat application mutation side effects.
A retry can cause another generation and need not return an identical body.

A failed invalidation cannot reverse an application commit.
When a mutation requests data invalidation, successful data invalidation precedes optional response invalidation.
Optional response invalidation failure cannot change the committed mutation into a failed mutation result.

The framework supplies no durable retry queue.
Applications own durable delivery of explicit invalidation requests when required.
Vercel owns regeneration retries accepted by its service.
Request background work under ADR 0026 supplies no durable delivery guarantee.

Operational failures emit bounded application-owned instrumentation with an opaque correlation identifier.
Results and instrumentation exclude credentials, internal cache keys, and provider response bodies.

### Credentials and destination authority

The deployment boundary holds the bypass token in server artifacts.
Public static files, browser bundles, navigation data, logs, and client errors must exclude it.

An exact trusted HTTPS deployment authority supplies authenticated invalidation destinations.
Incoming `Host` values and caller-supplied absolute URLs cannot select that authority.
Authenticated requests disable redirects.
The integration rejects user information and alternate destination authorities before it attaches credentials.

### Deployment replacement and rollback

Each deployment requires an explicit response-cache namespace and matching immutable assets.
The provider cache key includes a trusted build or deployment identifier.
An alias change alone does not establish cache isolation or simultaneous representation replacement.
A deployment change cannot assume that an earlier response entry has disappeared.
An old in-flight generation must not publish into the selected deployment namespace.

A forward deployment publishes its immutable assets before it exposes mutable documents that reference them.
Rollback restores the earlier artifact and its matching assets.
The deployment integration then invalidates each affected representation and supported variant as required by its verified provider contract.

A failed deployment invalidation leaves a recorded operation and an explicit retry owner.
Operators retain immutable assets while any cached document can reference them.
Rollback supplies no immediate global completion guarantee.

### Capabilities and implementation gates

Each provider capability belongs to a verified runtime and service configuration.
Build or startup validation rejects a known unsupported declaration.
A provider name alone cannot establish eligibility, stale limits, or cache consistency.

Inspection reports eligibility, refresh behavior, stale limits, supported variants, and capability failures.
It uses versioned diagnostics with declaration sources and repair instructions.
Inspection imports no route module and executes no loader.

A separate implementation issue must verify the complete public contract.
Its required checks include production browser navigation, private publication exclusion, packed consumers, and `pnpm verify`.
Local provider models verify operation order and failure handling.
Live probes establish provider behavior only for their recorded artifact, configuration, region, and request variants.

## Evidence boundary

The [isolated proof](../../docs/maintainers/vercel-isr-isolated-proof.md) records the October 17 observations and earlier rejected candidate.
Its evidence supports independent representation publication, stale retention, request validation, and acknowledgment uncertainty.
Saved-record assessment cannot establish a missing live observation.

The [completion proof](../../docs/maintainers/vercel-isr-completion-proof.md) records independent contribution freshness, browser navigation, artifact exclusions, and deployment rollback.
It preserves failed browser and alias observations alongside the corrected candidate.
The browser proof uses a protected transport bridge and excludes direct browser credential handling.
Local tests establish runtime rejection of unsafe response classes.
Live controls establish the recorded request exclusions and provider behavior.
Alias changes exposed mixed releases before later requests observed the selected artifact.
The namespaced proof establishes no global cutover deadline or atomic publication.
The public Vercel adapter retains uncached behavior until a separately verified implementation changes it.

## Later provider integrations

GCP configuration identifies its origin, CDN cache policy, URL map, permissions, and invalidation scope.
AWS configuration identifies its origin, distribution, IAM permissions, cache policy, and invalidation completion state.
Provider removal and origin regeneration remain separate operations.
Multiple origin instances require declared shared state and regeneration coordination.

Each integration verifies private-response exclusions, supported variants, stale limits, deployment namespaces, rollback, and application-owned retry delivery.
Firebase App Hosting and Amplify require separate assessments of their managed runtime boundaries.
No integration inherits a guarantee from a provider name or another implementation.
New integrations require their own capability contract, deployment probes, browser tests, and packed-consumer verification.

## Consequences

Applications retain existing data declarations and explicitly select response caching.
Shared caching supports a limited public input set with provider-managed stale serving.
Per-request application behavior remains in the shared pipeline.
Public implementation follows the accepted boundaries and its own verification issue.
A stronger consistency, stale-age, variant, or delivery guarantee requires evidence and a separate decision.
