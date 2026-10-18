# RFC 0231: Host Middleware Integration Boundary

## Status

Accepted as [ADR 0025](../architecture/decisions/0025-host-middleware-integration-boundary.md).

Tracking: [GitHub issue #231](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/231).

## Decision

Application middleware stays in the shared Demiurge route pipeline.
Provider middleware handles deployment routing and provider-required checks.
ADR 0025 defines execution order, security boundaries, and requirements for any future provider split.
