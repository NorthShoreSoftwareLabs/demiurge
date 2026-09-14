# RFC 0230: CDN cache invalidation and representation controls

## Status

Proposed. This RFC relates to [issue #230](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/230).

## Summary

`CacheStore` keeps application data. A CDN keeps HTTP representations.
These stores have different keys, lifetimes, access rules, and failure modes.

Demiurge keeps their invalidation contracts separate. It does not expose
surrogate keys, provider-neutral representation tags, or an automatic purge
operation in this proposal.

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

- Define a provider-neutral purge API.
- Add surrogate-key headers or cache-tag headers to framework responses.
- Change the `CacheStore` API or mutation success rules.
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
the configured `CacheStore`. It does not emit a header, call a CDN API, or
change a representation cache.

Demiurge does not map a data tag to a route, URL, surrogate key, or provider
purge key. The framework cannot prove that such a mapping covers every
representation or has safe scope.

An application deploy pipeline or deployment integration can purge mutable
representations. That integration is outside the mutation and `CacheStore`
contracts. It can use provider-specific paths, hostnames, keys, tags, or
versions.

### Mutation outcome

A successful data invalidation remains required before Demiurge returns a
successful mutation result. An optional representation purge must not change
that result to a failure.

If a purge starts from a mutation, the integration must run it after the
application commit. The integration must record and retry a failed purge by
its own reliable mechanism. Failure handling must not assume that the mutation
can roll back an application commit.

An integration can report purge state through application telemetry or an
operator channel. Telemetry must not expose provider credentials, provider
response bodies, cache keys, or internal topology to a client.

### Shared representation eligibility

An operator may place a response in a shared cache only when all conditions
below are true.

- The response has an explicit shared-cache policy.
- The response body and headers are identical for all requests with one cache
  key.
- The cache key includes each request header named by `Vary`.
- The response does not depend on a cookie, authorization credential, client
  identity, or request-specific security value.
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

After a mutable representation changes, the pipeline can purge its former
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

Applications keep one explicit contract for server data and another for HTTP
representations. Operators choose provider behavior without an implied framework
guarantee.

This decision does not prevent a future provider integration API. A future RFC
must define provider capabilities, authorization scope, observability, variant
selection, retry, and mutation semantics before it adds one.

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
