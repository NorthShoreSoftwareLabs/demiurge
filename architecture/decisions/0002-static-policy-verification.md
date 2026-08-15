# ADR 0002: Static Policy Verification

Status: accepted

Tracking: [GitHub issue #115](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/115)

## Context

Route modules declare CORS, rate limits, document security, and required adapter
capabilities. The framework previously validated many declarations only after a
matching request arrived.

The Vite build can read literal policy without running route modules. However,
environment-derived policy requires module evaluation during application
startup.

## Decision

- The Vite plugin extracts literal route policy from source during a build.
- The extractor does not run route modules.
- The extractor sends each literal value to the shared runtime validators.
- An unresolvable value does not cause a build failure.
- The extractor reads one file, so a requirement spanning the cascade is
  deferred to startup, which validates the merged policy.
- Development collapses a burst of watcher events into a single scan and never
  runs two scans at once.
- Generated server entries eagerly load route modules for startup validation.
- Direct adapters can pass eager route modules to `createRequestHandler(...)`.
- Adapter validation occurs only when the application selects an adapter.
- Request-time validation remains as defense in depth.
- Development and build use the same finding codes and messages.

CSP arrays merge additively by default. `{ replace: [...] }` replaces an
inherited directive. `false` removes an inherited directive.

## Consequences

- Invalid literal CORS and rate-limit policy fails the production build.
- Invalid environment-derived policy fails during handler construction.
- Static output rejects nonce-dependent policy before it writes output.
- Generated server entries evaluate route module side effects during startup.
- Dynamic policy remains outside build-time verification.
- A `csp.reportTo` group defined by an ancestor policy file fails during
  startup rather than during the build.

## Verification

Package tests cover extraction, build failure, startup failure, CSP cascade
behavior, adapter checks, and request-time validation.
