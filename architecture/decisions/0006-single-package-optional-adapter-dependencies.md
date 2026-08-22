# ADR 0006: Single Package With Optional Adapter Dependencies

## Status

Accepted.

## Context

Issue #149 asks whether each host adapter should become its own package, such
as `@demiurgejs/vercel`. The Vercel adapter lives in
`packages/core/src/static/vercel.ts` and ships through the
`@demiurgejs/core/static` subpath. The Node adapter ships the same way through
`@demiurgejs/core/node`. The 0.3.0 milestone adds an edge adapter (#73) and
shared adapter contract tests (#75), both of which need this boundary settled
first.

Before issue #149, `@vercel/routing-utils` was a normal dependency. Every
consumer installed it, including a consumer that deployed only to Node.

`packages/core/package.json` already has a precedent for an adapter-shaped
dependency that not every consumer needs. `vite` is a `peerDependency` marked
optional in `peerDependenciesMeta`, because the Vite plugin subpath is not
used by every consumer either.

`docs/maintainers/releasing.md` records that the `@demiurgejs` scope permits
independently versioned packages in the future, and that 0.2 keeps subpath
exports in one framework package. Splitting adapters into separate packages
means separate `package.json` files and a changed release workflow. Today one
tag publishes exactly two packages, `@demiurgejs/core` and `create-demiurge`.
A split also means a breaking import change for `vercelStatic`, which today
resolves from `@demiurgejs/core/static`.

## Decision

`@demiurgejs/core` stays one package through 0.3.0. The Node, Vercel, and
edge adapters all continue to ship as subpath exports of
`@demiurgejs/core`, versioned with the framework.

Host-specific runtime dependencies are not framework dependencies. They move
to `peerDependencies`, marked optional in `peerDependenciesMeta`, following
the existing `vite` precedent.

Issue #287 removes `@vercel/routing-utils` from the adapter. The framework now
creates the small required route set directly. It uses the patched
`path-to-regexp@6.3.0` package for application cache patterns.

This does not resolve the four numbered questions in #149 permanently. It
answers them for 0.3.0. No adapter gets its own package yet. A moved adapter
therefore has no re-export question. A package version question does not
arise, because there is one package.

## Consequences

No deployment installs `@vercel/routing-utils` through the framework.

Adding the edge adapter (#73) and the shared adapter contract tests (#75)
proceeds against a single package. Edge-specific dependencies, if any, follow
the same optional-peer-dependency pattern.

One package keeps one verification gate, one tag, and one version, matching
`docs/maintainers/releasing.md`. `vercelStatic` keeps its
`@demiurgejs/core/static` import path. No application has a breaking import
change to make.

The multi-package split stays available. Revisit it if an adapter needs a
release cadence independent of the framework, which optional peer
dependencies cannot provide.
