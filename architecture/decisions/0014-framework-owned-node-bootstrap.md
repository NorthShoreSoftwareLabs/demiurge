# ADR 0014: Framework-Owned Node Bootstrap

## Status

Accepted.

## Context

[ADR 0003](./0003-framework-owned-static-commands.md) left a follow-up open. The
first framework-owned build command targets static output, and a later adapter
command was to extend that interface.

Every Node example wrote the same production bootstrap by hand. Each file read
the browser manifest and resolved the client root from its own module URL. Each
file then built the request handler, read `HOST` and `PORT`, created the server,
and logged the bound address. Eighteen example files repeated that sequence.

The readiness endpoint at `/.well-known/ready` is part of the documented
deployment contract. Six examples hand-rolled the same six lines for it, and an
application that forgot the `503` answer would drain traffic incorrectly.

## Decision

The Node adapter supplies `serveNodeBuild(...)`. It reads the browser manifest and
resolves the client root. It also resolves the bind address and the host
allowlist, serves the client build, answers the readiness path, listens, and
reports the bound port.

The application supplies a `createHandler` callback. That callback receives the
manifest page options, the resolved client root, and a `waitUntil` binding for
the server that does not exist yet. The callback returns the request handler,
so an application can still wrap route dispatch with its own paths.

`createNodeServer(...)` gains a `readyPath` option. It answers that path with
`200` while `isReady()` is true and `503` once shutdown starts.

The framework does not add a `demiurge start` command. A Node process needs an
application cache store, an application server entry, and application middleware
that a command line cannot express. The static commands can own the whole build
because static output has no runtime application values.

## Consequences

A Node deployment declares its differences and inherits the rest. The common
example dropped from about thirty lines to about six.

The readiness contract has one implementation. An application that sets
`readyPath` cannot answer it incorrectly, and an application that needs a
different path or no readiness endpoint can still say so.

The helper reads the browser manifest through the same parser the static build
command uses, so both paths reject the same malformed manifest.

An application that needs a different process shape can still call
`createNodeServer(...)` directly. The helper is a default, not a boundary.
