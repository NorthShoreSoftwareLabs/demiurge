# ADR 0014: Framework-Owned Node Bootstrap

## Status

Accepted.

## Context

[ADR 0003](./0003-framework-owned-static-commands.md) left a follow-up open. Its
first framework-owned build command targets static output, and a later adapter
command was to extend that interface.

All Node examples wrote the same production bootstrap by hand. Each file read
the browser manifest and resolved the client root from its own module URL. Each
bootstrap then built the request handler, read `HOST` and `PORT`, created the
server, and logged the bound address. Eighteen example files repeated that sequence.

Readiness at `/.well-known/ready` is part of the documented
deployment contract. Six examples hand-rolled the same six lines for it, and an
application that forgot the `503` answer would drain traffic incorrectly.

## Decision

Demiurge supplies `demiurge build` and `demiurge start` for a standard
production process. Build writes the browser bundle and the declared server
runtime bundle. Start reads the browser manifest, loads that runtime, serves
the client build, answers the readiness path, and listens.

An application supplies a server-only runtime module. It exports
`createHandler(context)`. The context contains manifest page options, the
resolved client root, and `waitUntil`. The module can export
`createStatic(context)` for a composed font, image, or static-file handler.

Start requires `ALLOWED_HOSTS`. It passes that explicit allowlist
to the Node adapter. It also installs the standard SIGINT and SIGTERM graceful
shutdown handlers.

`createNodeServer(...)` and `serveNodeBuild(...)` remain public. An application
uses them when it owns the process or requires a different bootstrap shape.

## Consequences

A Node deployment declares its runtime dependencies and inherits the process
defaults. The application no longer needs a `server.js` bootstrap file.

Readiness has one implementation. An application that sets
`readyPath` cannot answer it incorrectly, and an application that needs a
different path or no readiness endpoint can still say so.

A shared parser reads the browser manifest for static builds and Node starts.
Both paths reject the same malformed manifest.

For a different process shape, an application can still call
`createNodeServer(...)` directly. The helper is a default, not a boundary.
