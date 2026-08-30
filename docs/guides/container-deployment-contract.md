# Container Deployment Contract

The Node adapter produces one production process. Any container platform that
starts that process correctly gets a working deployment. This document names
the rules a container platform must satisfy, separate from the settings a
specific platform chooses. Read the [Node deployment guide](./node-deployment.md)
first for the framework side of each rule. [Cloud Run deployment](./cloud-run-deployment.md)
is one conforming implementation of this contract.

A rule below is a framework requirement when the adapter enforces or depends on
it. A setting is a provider choice when the platform decides the value and the
application only reads it.

## Port and bind address

**Framework requirement.** `server.js` reads `PORT` and `HOST` from the
environment rather than hardcoding either. The process binds to whatever
address and port the platform hands it, and it never assumes a default that
only holds locally.

**Provider setting.** The bind address depends on where the platform's
connection comes from. A platform that connects to the container's own
address, with no local peer, needs `HOST=0.0.0.0`. A platform that places a
reverse proxy on the same host can bind loopback instead. The port number
itself is almost always a provider setting, assigned at deploy time or fixed
by convention.

## Host validation and trusted proxies

**Framework requirement.** `allowedHosts` is mandatory on every deployment.
The adapter checks the request authority before it becomes a Web `Request`
URL, so a forged `Host` header never reaches route code. `trustProxy` is
disabled by default for the same reason. A process that trusts forwarded
headers from anyone has no client address at all.

**Provider setting.** The allowed hostnames are whatever the platform routes
to the container, whether that is a `*.run.app` domain, a custom domain, or
an internal service name. The trusted proxy configuration depends on the network path
in front of the container. Exactly one trusted hop in front of the process
calls for `trustProxy: { hops: 1 }`. A proxy fleet with stable addresses calls
for `trustProxy: { ranges: [...] }` instead. Never enable proxy trust on a
process that clients can also reach directly. That reach makes the proxy
bypassable. See the [CDN and reverse-proxy contract](./cdn-reverse-proxy-contract.md)
for the full proxy requirements.

## Readiness, termination, and graceful shutdown

**Framework requirement.** The server exposes `server.isReady()` and a
configurable `shutdown` option. A configured signal handler flips
`isReady()` to false, stops accepting new connections, closes idle sockets,
drains active responses, and force-closes at the grace deadline. A readiness
endpoint should return `503` as soon as `isReady()` is false, so a platform
health check can route around a draining instance.

**Provider setting.** The platform decides which signal it sends before it
removes an instance from traffic, and how long it waits before a hard stop.
Configure `shutdown.signals` to match, and set
`shutdown.gracePeriod` no longer than the platform's own termination
deadline. A host that owns process signals itself, rather than delivering
them to the container, should call `await server.shutdown()` directly instead
of configuring `signals`.

## Immutable filesystem and multiple replicas

**Framework requirement.** The Node static handler serves `dist/client` from
a configured `root` that the build populates once. Nothing in the framework
writes application state to that directory at runtime, and nothing reads
instance-local state back across requests.

**Provider setting.** Whether the platform actually enforces an immutable or
ephemeral filesystem, and whether it can start any number of replicas at
once, is a platform property. Treat both as guaranteed regardless of what a
specific platform currently does. A request that writes a file at runtime
should not expect a later request to read it back. That later request may
land on a different, freshly started, or already-replaced instance.

## Shared cache and rate limit stores

**Framework requirement.** `createHandler(...)` accepts a `CacheStore`. The
in-memory default is scoped to one Node process. It works correctly only
where a deployment runs exactly one replica with no restart-driven cache
loss expected. A deployment that runs, or may run, more than one replica
should inject a shared Redis or KV implementation. That implementation must
pass the conformance contract in `@demiurgejs/core/data/testing`. The same
applies to any rate limit store the application configures.

**Provider setting.** Which shared store backend is available, and how the
application reaches it, depends on the platform. A single always-on instance
can defer this and use the in-memory default. A platform that scales to
multiple replicas, or that recycles instances between requests, cannot.

## Conforming deployments

[Cloud Run deployment](./cloud-run-deployment.md) satisfies every rule above
inside a fully managed container platform. A VM or bare-metal host behind a
reverse proxy can satisfy the same contract too. That host needs a single
trusted proxy hop and a process manager that forwards termination signals.
Either shape is a conforming deployment as long as it upholds the rules in
this document.
