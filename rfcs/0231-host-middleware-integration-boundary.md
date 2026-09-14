# RFC 0231: Host Middleware Integration Boundary

## Status

Proposed.

Tracking: [GitHub issue #231](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/231).

## Context

`@middleware.ts` runs in the Demiurge route pipeline. It receives the matched
route, the normalized request, and the request context. The pipeline applies
request-security policy before application middleware runs. Authorization runs
after middleware calls `next()` and before the route capability runs.

Some deployment providers offer middleware before an origin or a function.
That middleware has no matched Demiurge route. It can have different request
data, response rules, error handling, and environment access.

Copying `@middleware.ts` into a provider program would create two application
pipelines. The copies could run in a different order or receive different
values. A copy could also include server-only modules or secrets in generated
provider output.

## Decision

### Default ownership

Demiurge owns application middleware.

An application declares request middleware through `@middleware.ts`. It can
use `defineMiddleware` for typed context contributions. Demiurge runs each
applicable middleware once in the shared route pipeline.

Each provider owns its own pre-origin behavior. Provider configuration can
route traffic, serve provider assets, and perform provider-required checks.
Provider configuration must not execute application `@middleware.ts` or
present a provider middleware API as an equivalent application API.

An adapter must normalize a provider request before it enters the route
pipeline. The normalized request is the only request that application
middleware receives.

### Execution order

The default request order applies after a request continues past method and
CORS preflight handling.

1. The provider accepts the request and applies its transport rules.
2. The adapter creates the Web `Request` and starts the shared route pipeline.
3. Route matching resolves the method capability.
4. Inherited request-security policy then applies request security.
5. Inherited application middleware runs from root to leaf.
6. Authorization then applies before the route capability runs.
7. Response finalization, error handling, and document security output apply.

Request security includes Fetch Metadata, CSRF, rate limits, and a request body
limit. Every route inherits the bounded body limit when no policy overrides it.

A CORS preflight or unsupported method can end the request before this order.
A request-security check can also end the request before middleware runs.

An application middleware response short-circuits later application middleware
and the route capability. Response finalization still applies as the route
contract requires.

Provider middleware is outside this order. This provider can reject a request
before Demiurge receives it. That rejection is provider-owned. It does not
promise a framework error document or route security behavior.

For a request that enters Demiurge, provider middleware cannot bypass framework
security, change the matched route after policy resolution, or replace a
framework error document.

### No split execution by default

An adapter must use the shared route pipeline for development, Node production,
edge production, and static behavior where that pipeline applies. An integration
must not split application middleware to improve an unmeasured
latency, locality, or provider-routing concern.

This RFC defines no host middleware extension. An application
that needs provider pre-origin work keeps that work in provider configuration
or a provider-owned integration. It does not add values to Demiurge request
context.

### Future provider split extension

A future extension may split a limited pre-origin phase only after a measured
requirement shows that the shared pipeline cannot meet it. The proposal must
state the workload, measurement method, baseline, required result, and the
provider environments that need the split.

The extension must be explicit. The extension must add a named adapter capability such as
`hostMiddleware`. An adapter declares that capability only when its provider
can run the generated phase and preserve the requirements in this RFC.

The extension must keep `@middleware.ts` in the shared pipeline. It may add a
separate, provider-specific declaration. Its name, input type, output type,
and supported operations must make the different execution boundary clear.

The generated provider program must be declarative and limited. This program
must not import an application route module, a server-only module, or an
arbitrary provider SDK. The program must not read an undeclared environment value. The
build must reject a declaration that requires a forbidden input.

### Typed data boundary

A future split phase may send request-context values to the route pipeline only
through an adapter-owned envelope. A public request header, cookie, URL value,
or body field is not an envelope. Rewrites and short-circuit decisions use
their separately declared decision types.

The envelope must meet all these rules.

- The adapter creates and verifies it for one request.
- The envelope is valid only between the declared provider phase and adapter.
- The provider binds it to the deployment, build, request method, URL, and a
  short lifetime.
- A unique nonce is consumed atomically during verification.
- The adapter rejects an envelope after its nonce is consumed.
- An external client cannot create, modify, or replay it as a trusted value.
- Its fields use a versioned, runtime-validated schema.
- Its context fields have generated TypeScript declarations for later
  middleware and route capabilities.
- Its schema permits only declared serializable values.
- The framework removes it before application response headers leave the
  runtime.

The provider phase cannot transfer a request body, a `Request` object, a
database record, a session secret, or a provider credential through the
envelope. The runtime must resolve those values after the shared pipeline
starts.

The generated provider program and envelope must never enter a browser bundle.
They must also stay out of navigation data, errors, route audits, and readable
static artifacts. The build must reject a server-only transfer.

### Security and response boundary

A host phase may continue a request, select a predeclared route rewrite,
or return a declared short-circuit decision. Demiurge must validate each
decision before it takes effect.

Before a rewrite, the provider phase discards the original envelope. It creates
a replacement only after it resolves the final request method and URL. Demiurge
matches that request and runs the complete shared pipeline. The provider phase
cannot select a route capability directly.

For a short-circuit decision, the provider integration must prove that the
result preserves route policy, response headers, error format, redirect
semantics, and observability output. The generated provider program must use
framework-generated declarations. Generated code must not build an application response
from arbitrary code.

Routes with dynamic authorization always continue through the shared pipeline.
A host short-circuit can serve only a route with statically representable
public access policy. It cannot execute `defineAuthorization` hooks or use
application middleware context to make an authorization decision.

Without this proof, an integration must continue the request to the shared
pipeline. No integration may claim the host middleware capability.

### Capabilities and conformance

A host middleware capability is an adapter and deployment claim. It is not a
general boolean that a provider can set without proof.

The adapter contract must prove at least these behaviors.

- The shared pipeline executes each `@middleware.ts` file once in root-to-leaf
  order.
- The host phase cannot bypass Fetch Metadata, CSRF, rate limit, or request
  body enforcement. It also cannot bypass authorization.
- A verified envelope provides declared context values and rejects changed,
  expired, and replayed envelopes.
- A rewrite discards the old envelope, verifies a replacement, and resolves
  policy from the final matched route.
- A protected route and a route with dynamic authorization continue through the
  shared pipeline.
- A declared short-circuit preserves required headers, status, redirect, and
  error behavior.
- Generated output excludes server-only modules, secrets, and envelope data.

The deployment conformance kit must run the same base probes against a real
provider deployment. The base probes cover document, navigation data, API,
rejected, and redirect requests. Each declared operation adds its own probe.
Rewrite support requires a rewrite probe. Short-circuit support requires a
short-circuit probe.

Each provider integration must declare the exact environments and operations
that it supports. Rewrite-only integrations must not claim
short-circuit support. A capability without passing adapter and deployment
probes remains false.

## Consequences

Applications receive one middleware model and one request context model by
default. Policy, errors, redirects, and short-circuit behavior remain defined
by the same route pipeline in every supported execution mode.

Provider integrations retain a path for a measured pre-origin requirement.
That path has a separate declaration, an authenticated typed boundary, and
adapter and deployment conformance requirements. It does not make provider
middleware an implicit replacement for application middleware.

## Open Questions

No host middleware capability is proposed for implementation now. A later
proposal must define its public API and the first provider target after it
supplies the required measurement and conformance design.
