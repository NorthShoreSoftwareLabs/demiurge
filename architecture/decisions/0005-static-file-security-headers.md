# ADR 0005: Static File Security Headers

## Status

Accepted.

## Context

The static manifest declares route entries and file header rules. A route entry
carries the full document header set. A file rule carried a cache policy only.

Content-hashed bundles and copied public files have no route entry. A host that
applies the manifest therefore served those files without a security policy.

An application could apply one header set to every path in its own host
configuration. A generated Build Output artifact removes that opportunity,
because the framework now owns the deployed routing table.

## Decision

Every file header rule carries a baseline security header set.

The baseline is the document header set of the root `@policy.ts` policy. One
declaration therefore governs documents and files.

The baseline excludes the Content Security Policy. The framework cannot hash a
file it did not render. It excludes Trusted Types with it, because a browser
reads Trusted Types from the Content-Security-Policy header only.

An application declares extra rules through the Vite plugin `static.headers`
option. Each rule pairs a file pattern with the same typed header policy that
route policies declare. The framework merges a declared rule over the baseline
and matches it before the framework cache rules.

## Consequences

A file without a route entry keeps `cross-origin-resource-policy`,
`x-content-type-options`, and the other document headers on every host that
applies the manifest.

An application that serves a font or an image to another origin declares that
exception in one typed place. The Node adapter, the preview server, and the
Vercel output read the same rules.

An application without a root document policy receives cache rules only. The
framework does not invent a policy the application did not declare.

The Vercel translator accepts an arbitrary file pattern. It converts an
unanchored basename test into an equivalent pathname source.
