# ADR 0003: Framework-Owned Static Commands

## Status

Accepted.

## Context

A static application repeated the same client build, server build, and export
sequence. Each application also declared the framework virtual server entry.

Vite preview did not apply the headers from the static output manifest. It
therefore did not reproduce the security policy for the generated site.

## Decision

The `@demiurgejs/core` package supplies a `demiurge` command.

`demiurge build` runs the client build and the server route build. It then runs
the static adapter against those artifacts.

`demiurge preview` reads the static output manifest. It applies each route
entry and each file header rule when it serves the output.

The commands use the application Vite configuration. The commands use the
framework virtual entries without an application server entry.

The static adapter API remains public. An application can use that API for a
custom build or deployment pipeline.

## Consequences

An application can build static output without an export script. It can also
preview the declared security and cache headers with one command.

The preview is a local conformance server. It does not reproduce provider TLS,
compression, validators, range support, or provider configuration.

The first framework-owned build command targets static output. A later adapter
command can extend this interface without changing the static manifest.

[ADR 0014](./0014-framework-owned-node-bootstrap.md) delivers that follow-up for
the Node adapter. It supplies a library helper rather than a second command,
because a server process needs application values a command line cannot carry.
