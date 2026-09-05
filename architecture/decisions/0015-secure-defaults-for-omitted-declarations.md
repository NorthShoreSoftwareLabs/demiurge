# ADR 0015: Secure Defaults for Omitted Declarations

## Status

Accepted.

## Context

Demiurge lets an application declare a document policy, an environment schema,
and request limits. Each declaration is optional. An application that omits one
still starts, builds, and answers requests.

An omitted declaration is therefore an unsafe default.

- A page route that inherits no `document` policy sends no
  Content-Security-Policy. [ADR 0002](./0002-static-policy-verification.md)
  gave the build a static reader of the policy cascade, and issue #387 made the
  build report the gap. The build still completes.
- A required environment variable uses `critical: false`. The server starts
  without the value and warns. The failure appears during a production request.
- `RequestSecurityPolicy.maxBodySize` has no value until a route declares one.
  A route without the declaration buffers a body of any size.

The framework can detect each of these gaps at build time or at startup.

## Decision

The framework refuses an omitted declaration where the omission removes a
security guarantee. Each refusal names the route, the policy source, and the
exact repair.

### Document policy

Every page route requires an inherited document policy. A page route that
inherits none fails the build.

The framework distinguishes an absent policy from a policy that turns off the
Content-Security-Policy.

- An absent policy is an error. The build stops.
- `csp: false` accepts a document without a Content-Security-Policy. The
  document keeps every other security header of its policy. A separate
  declaration removes any other header.

An application-owned fallback document uses the same rule as a page route. A
`@not-found.tsx` route and a route error document both render HTML, so both
require an inherited policy.

The scaffold writes a root `@policy.ts` with `document: security.strict()`, so
a new application starts with the guarantee.

A deliberate exception stays typed and visible. The security audit reports each
route that accepts a document without a policy.

The build validates a static policy against the capabilities of the static
adapter. A policy that a static host cannot deliver fails the build rather than
the deployment.

### Environment values

The framework validates every required value before the server accepts traffic.
A required value that is absent or invalid stops the start.

`optional` and `deferred` become separate declarations.

- `optional` permits absence. The framework validates a supplied optional value
  at startup.
- `deferred` postpones validation until the first server access of the value.
  The access reports a clear error. The error does not contain the value.

A browser-exposed value has no deferred form. The build validates each value
that `client: true` marks, because the build inlines that value.

The `critical` option is replaced. The migration is mechanical, and the section
below records it.

The framework refuses a declaration that combines `optional` with `deferred`,
or `client` with `deferred`.

### Request limits

A route inherits a bounded body limit. The shared pipeline enforces the limit
while it reads bytes, so a request without `Content-Length` cannot pass the
limit.

A route that accepts an upload or a stream declares its own limit. The
declaration stays typed, and inspection output reports it.

The framework reports an adapter that cannot enforce a declared boundary,
because the shared pipeline does not own every timeout.

## Consequences

An application that omits a declaration learns at build time or at startup, not
during a production request. This is the stated goal of the epic.

Every change is a breaking change for an application that relies on the current
permissive behavior. The package is a prerelease, so the migration cost is
lower now than after a stable release.

The migration for each default is:

- A page route without a document policy: add `document: security.strict()` to
  a `@policy.ts` file above the route. To accept a document without a
  Content-Security-Policy, declare `csp: false`.
- A required environment value that must not stop the start: declare
  `optional: true` when absence is valid. Declare `deferred: true` when the
  first access validates the value.
- A route that reads a body larger than the inherited limit: declare
  `security.request.maxBodySize` on the route.

No API name changes to satisfy the writing standard.

The framework does not guess a value. A build error asks the application to
declare the value. A build error never weakens a security guarantee to make
itself go away.
