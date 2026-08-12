# Platform Boundaries

This record defines where a Demiurge capability belongs. The locations are core,
an integration package, or application code. This record is not a feature
inventory. GitHub issues are the delivery-status source.

## Inclusion rule

A capability belongs in core when other framework systems become more correct
because it is present. The strongest signals are that it affects more than one
of:

- route matching or request handling
- framework-owned document output
- security policy or auditability
- rendering and hydration
- cache identity or invalidation
- adapter capability negotiation
- generated types or build validation

Pure convenience is not enough. General observers, schedulers, debounce
helpers, worker pools, and unrelated UI utilities remain application or
ecosystem concerns unless they acquire a framework-wide contract.

## Current core boundaries

Core owns:

- file routes, route capabilities, middleware, and inherited policy
- the HTML document, metadata, declared scripts, resource hints, and SEO output
- browser navigation, server data envelopes, SSR, streaming, and static output
- CSP, CORS, CSRF, request limits, rate limits, reports, and security audits
- explicit cache scopes, invalidation, idempotency, and the cache-store contract
- adapter capability declarations and the Node/static adapters
- typed image, font, analytics, and instrumentation declarations where they
  feed document, policy, or runtime output

Core does not own provider SDKs, generic UI components, general-purpose utility
functions, application authorization models, database access, or deployment
provisioning.

## Integration packages

A separately versioned package is appropriate when a capability implements a
published core contract but depends on a provider or runtime. Expected examples
include Redis/KV cache stores and non-Node deployment adapters.

An integration must feed the same policy, audit, cache, or adapter surfaces as
core. It must not create a parallel configuration system.

## Application code

Applications retain ownership of business data, authentication and
authorization decisions, visual components, route content, third-party vendor
selection, and operational policy specific to their deployment.

Framework helpers can make those declarations typed and auditable without
choosing them for the application.

## Proposed capabilities

Substantial unsettled designs belong in `rfcs/`. Delivery work and priorities
belong in GitHub issues and milestones. Architecture documents should be changed
only when the boundary itself changes.
