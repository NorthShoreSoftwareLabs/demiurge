# ADR 0018: Extension and Security Exception Contracts

## Status

Accepted.

## Context

Demiurge ships several security defaults. Each default arrived in a separate
change. Each default brought its own escape hatch. The hatches do not agree
with each other.

Issue #404 asks for one contract. A survey of `main` at commit `0aa62f8` found
four disagreements.

- Only one exception requires a justification. `RouteAccessException.reason` is
  mandatory at `packages/core/src/security/types.ts:327`. The `csp: false`,
  `csrf: false`, and raised `maxBodySize` exceptions accept no reason.
- The audit reports some exceptions and hides others. `createSecurityAudit(...)`
  reports the document and route exceptions. The upload policy exception in
  `packages/core/src/security/upload.ts` reaches no audit surface, because an
  application calls `validateUploads` inside its own handler. The environment
  exceptions `optional`, `deferred`, and `client` reach no audit surface either.
- A framework helper declares an exception that looks like an application
  decision. `webhook.hmac()` sets `csrf: false` at
  `packages/core/src/route/webhook.ts:49`. The audit gives the same
  `csrf-disabled` finding for this helper and for an application declaration.
- Two audit systems produce the same code strings for different types. The
  runtime audit types `SecurityAuditFinding.code` as `string`. The build
  verifier types `StaticPolicyFinding.code` as a closed union. The strings
  `access-declaration-missing`, `cors-invalid`, and
  `security-header-render-failed` exist in both. The string `csp-missing` and
  the string `document-policy-missing` name the same gap in the two systems.

The roadmap product rule in issue #393 states that a security exception stays
local, typed, and inspectable. The route exceptions meet the three properties.
The environment and upload exceptions meet one property.

## Decision

### A security exception states a reason

Every typed security exception takes a mandatory `reason` string. This applies
to `csp: false`, to `csrf: false`, and to a `maxBodySize` value above the
default. `RouteAccessException.reason` already meets this rule and does not
change.

The audit reports the reason with the finding. A reader of the audit learns
what the application accepted and why the application accepted it.

This change breaks an application that declares one of these exceptions today.
The migration section below gives the rule.

### The audit reports the declaration source

A finding states whether the application declared the exception or whether a
framework helper declared it. The audit gives the file that holds the
declaration. A helper such as `webhook.hmac()` names itself as the source.

An application reads the audit and finds every exception, including the
exceptions that a helper made on its behalf.

### One diagnostic code vocabulary

`SecurityAuditFinding.code` becomes a closed union. The build verifier and the
runtime audit share one code vocabulary.

A code string names one condition. The framework removes the duplicate meaning
of `access-declaration-missing`, `cors-invalid`, and
`security-header-render-failed`. The framework uses one string for the missing
document policy and removes the second name.

A consumer reads a code and learns the condition without reading the source
that produced it.

### The advanced Vite hatch stays open and states its risk

`unstable_viteConfig` becomes `unsafe_unstable_viteConfig`. The callback keeps
its current capability. An application still receives the resolved Vite
configuration and still returns a rewritten configuration.

The framework adds no check that its own plugins survived the rewrite. An
application that removes the framework plugins loses the server-only module
boundary and the client environment boundary. The application then owns those
boundaries.

The name states both properties. The interface has no compatibility guarantee
between versions, and a rewrite can remove a security boundary.

### The extension ownership table

Issue #404 also asks for an ownership record. An application extends the
framework at seven public surfaces. For each surface, the table states the
public API, the guarantee the framework keeps, and the responsibility the
application takes on.

Issue #408 verifies a public example for each representative replacement that
this table identifies.

| Surface | Public API | Framework keeps | Application owns |
| --- | --- | --- | --- |
| Custom servers | `nodeAdapter`, `createNodeServer`, `createNodeRequestListener` (`node/index.ts`), `createEdgeRequestHandler` (`edge/index.ts`), `generateStaticOutput` (`static/index.ts`) | Request timeout enforcement, graceful shutdown draining, abort propagation, origin policy validation, and typed adapter capabilities that refuse to start on a gap | The server process, the listener, deployment, and any adapter capability the chosen runtime does not provide |
| Authentication providers | `createSessionManager` (`security/session-manager.ts`), a `SessionStore`, the cookie session helpers, `defineAuthorization` (`security/authorization.ts`) | Authorization before the loader, before a protected cache read, and before a mutation effect, with a default denial when a route declares no access | Identity, the login flow, and a third-party identity SDK call |
| Stores | `Cache`, `CacheStore`, `RateLimitStore`, `SessionStore`, the memory factories, `@demiurgejs/core/kv`, `@demiurgejs/core/redis` | Conformance helpers for a store contract, and a refusal to start the edge adapter on a silent per-isolate cache or rate limit store | Durability, atomicity, and network failure handling |
| Queues | None | Not applicable | Not applicable. Issues #235 and #251 defer this surface |
| Raw responses | `response()` (`route/response.ts`) | Fetch Metadata, CSRF, rate limit, body size, and authorization checks before the application function runs, and CORS, Server-Timing, and HEAD normalization after | The full header set, the body, and the status. The pipeline does not add the document security headers to a raw response |
| Application middleware | `defineMiddleware` (`route/middleware.ts`) | A fixed position in the pipeline, after the Fetch Metadata, CSRF, rate limit, and body size checks, and before authorization | A context value it adds, and a decision to short-circuit by returning a response before it calls `next()` |
| Advanced Vite configuration | `DemiurgeConfig.vite` (`DemiurgeViteExtension`) and `unsafe_unstable_viteConfig` | `DemiurgeConfig.vite` keeps a bounded, typed surface. `unsafe_unstable_viteConfig` keeps no compatibility guarantee, and the section above states its risk | A rewrite through `unsafe_unstable_viteConfig` that removes the server-only module boundary or the client environment boundary |

The following notes give the file path and the line for each claim in the
table.

**Custom servers.** An application starts the framework through
`nodeAdapter` (`node/index.ts:62`), `createNodeServer`
(`node/index.ts:212`), `createNodeRequestListener` (`node/index.ts:120`),
`createEdgeRequestHandler` (`edge/index.ts:93`), or `generateStaticOutput`
(`static/index.ts:185`). The Node adapter keeps request timeout enforcement,
graceful shutdown draining, and abort propagation
(`node/index.ts:178-244, 352-421`), and validates the origin policy at
`node/index.ts:123`. `AdapterCapabilityMap` types each adapter capability as a
boolean (`adapter/index.ts:1-12`), and `assertAdapterCapabilities`
(`adapter/index.ts:70-82`) throws instead of starting a server that lacks a
required capability.

**Authentication providers.** The framework defines no dedicated provider
type. An application composes `createSessionManager`
(`security/session-manager.ts:67`), a conforming `SessionStore`
(`security/session-store.ts:33`), the cookie session helpers, and
`defineAuthorization` (`security/authorization.ts:20`). The pipeline runs
authorization before the page loader, before a protected cache read, and
before a mutation effect (`server/request-handler.ts:471-478, 610-616`). The
pipeline denies the request by default when a route declares no access. The
application owns identity, the login flow, and a call to a third-party
identity SDK.

**Stores.** The framework types `Cache` and `CacheStore`
(`data/cache.ts:55, 78`), `RateLimitStore` (`security/types.ts:305`), and
`SessionStore` (`security/session-store.ts:33`). The framework supplies the
memory factories (`data/cache.ts:384-400`, `security/rate-limit.ts:32`,
`security/session-store.ts:60`) and the `@demiurgejs/core/kv` and
`@demiurgejs/core/redis` entry points. Core supplies conformance helpers
through `verifyCacheStoreContract` (`adapter/testing.ts`, `data/testing.ts`).
The edge adapter refuses to start with a silent per-isolate cache or rate
limit store. It requires the literal string `"unavailable"` as an explicit
refusal (`edge/index.ts:52, 143, 159`). The application owns durability,
atomicity, and network failure handling.

**Queues.** No queue surface exists in the framework. Issues #235 and #251
defer this surface. This ADR states no contract for it.

**Raw responses.** An application builds a raw response with `response()`
(`route/response.ts:144`). The pipeline still enforces Fetch Metadata, CSRF,
rate limiting, body size, and authorization before the application function
runs (`server/request-handler.ts:383-478, 610-616`). The pipeline applies
CORS, Server-Timing, and HEAD normalization after, through
`finalizeRouteResponse` (`server/request-handler.ts:927-945`). The pipeline
does not apply the document security headers to a raw response.
`createSecurityHeaders` runs only on the page branch
(`server/request-handler.ts:558-565`). The application owns the rest of the
header set, the body, and the status.

**Application middleware.** An application declares middleware with
`defineMiddleware` (`route/middleware.ts:13`). Middleware always runs inside
the shared pipeline, after the Fetch Metadata, CSRF, rate limit, and body
size checks, and before authorization. Middleware cannot skip those checks.
Middleware can add a context value, or short-circuit the request by
returning a response before it calls `next()`.

**Advanced Vite configuration.** Two surfaces carry opposite guarantees.
`DemiurgeConfig.vite` (`DemiurgeViteExtension`, `config/types.ts:59-65`) is a
bounded, typed surface of `define`, `optimizeDeps`, `plugins`, and
`resolve.alias`. `unsafe_unstable_viteConfig` (`config/types.ts:89-91`) is an
unbounded rewrite of the resolved configuration, with no compatibility
guarantee. The rewrite can remove the server-only module boundary and the
client environment boundary. The section above states the rewrite hatch and
its risk. This table cross-references it rather than repeating it.

## Consequences

- An application that declares a security exception states a reason. The reason
  appears in the audit.
- The audit separates an application decision from a framework helper decision.
- A tool reads one code vocabulary across the build and the runtime.
- The advanced Vite hatch remains available. Its name states the risk.
- The framework keeps no global switch that disables unrelated checks.
- An application keeps direct use of a provider SDK where core adds no
  contract.

## Migration

- Add a `reason` to each `csp: false`, `csrf: false`, and raised `maxBodySize`
  declaration. The build fails until the declaration states a reason.
- Rename `unstable_viteConfig` to `unsafe_unstable_viteConfig`. The framework
  removes the old name. A configuration that declares the old name fails
  validation as an unknown field.
- Read the finding code table in the documentation when a tool matches a code
  string. Two codes changed name.

## Open items

This decision does not settle the following. Issue #405 settles them.

- The version field of the inspection report.
- The meaning of the `unstable_` export prefix and the path out of it.
- The command surface for static inspection.
- The redaction rule for a secret value in a report.
