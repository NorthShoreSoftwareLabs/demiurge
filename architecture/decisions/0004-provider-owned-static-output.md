# ADR 0004: Provider-Specific Static Output

## Status

Accepted.

## Context

The static manifest contains route headers, file cache rules, and the app-owned
fallback. A production host must apply this contract.

A generated root `vercel.json` cannot use the current build manifest. Vercel
reads that file before the build starts.

Vercel defines Build Output API version 3 for framework build commands. The
format includes static files, routing phases, headers, and file overrides.

## Decision

The Vercel static adapter converts the static manifest into Build Output API
version 3.

An application selects the adapter through the Demiurge Vite plugin. The
framework build then writes `.vercel/output`.

The adapter applies route headers before static-file cache rules. It uses the
Vercel hit phase for file rules.

The adapter uses the Vercel error phase for the app-owned fallback. Unknown
paths keep the fallback status and headers.

The application can add typed Vercel cache rules. These rules can override
framework file-cache defaults.

The adapter does not generate a root `vercel.json`. Project build settings and
deployment-specific policy remain application inputs.

## Consequences

A Vercel deployment does not need an application manifest translator. It also
does not need a committed header synchronization step.

The build publishes only deployable files under `.vercel/output/static`.
Framework manifests remain private build artifacts.

The application must select the Vercel `Other` preset until Vercel supplies a
Demiurge preset. The application must not override the output directory.

Provider-specific header syntax is validated with Vercel routing utilities.
The framework rejects an invalid rule during the build.
