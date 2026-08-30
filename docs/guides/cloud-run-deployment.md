# Cloud Run Deployment

Cloud Run runs a container. The Node adapter already produces the process that
container needs, so this document covers the container shape rather than new
framework code. Read the [Node deployment guide](./node-deployment.md) first.
Everything there about the build output, static files, and shutdown still
applies inside the container. [`examples/cloud-run`](../../examples/cloud-run)
is the complete, buildable version of what follows.

Cloud Run is one conforming implementation of the
[container deployment contract](./container-deployment-contract.md). This
document names the provider settings Cloud Run needs for each framework
requirement that contract defines.

## Container shape

The image builds in two stages. A builder stage installs workspace
dependencies and runs the same `vite build` commands the Node deployment guide
describes, producing `dist/client`, `dist/server`, and a pruned
`node_modules`. A runtime stage copies only that output into a slim base
image and starts `node server.js`. The build stage never ships. Cloud Run
runs the runtime stage's image, and nothing it contains still references the
monorepo source tree.

```
FROM node:22-alpine AS builder
# install, build

FROM node:22-alpine AS runtime
# copy dist/, server.js, node_modules
CMD ["node", "server.js"]
```

## Port binding

Cloud Run assigns the container's listening port at deploy time through the
`PORT` environment variable and connects to it on `0.0.0.0`. A container that
listens on a fixed port such as `4173`, or on `127.0.0.1`, never receives
traffic. `server.js` already reads both correctly:

```js
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);
```

The default host differs from the Node deployment guide's `127.0.0.1` on
purpose. A bare-metal or VM deployment usually sits behind a local reverse
proxy and can bind loopback safely. A Cloud Run container has no loopback
peer. The platform connects to the container's own address, so `0.0.0.0` is
the only correct default here.

`ALLOWED_HOSTS` still applies, and it is not the bind address. Set it to the
Cloud Run service's `*.run.app` hostname, or to a custom domain mapped to the
service. `toWebRequest` then accepts the `Host` header Cloud Run's front end
forwards.

## Health checks

Cloud Run's default startup probe is a TCP check against the container port.
The revision is marked healthy the moment something accepts a connection
there, before the framework has served a single request. `server.js` loads the
SSR bundle and the client manifest, then calls `server.listen(...)`, all
before the process does anything else. A container that starts at all is a
container that can already answer. No custom `startupProbe` configuration is
required for this adapter.

An HTTP probe, or a load balancer's own health path, can instead target
`/.well-known/ready`, the same endpoint the Node deployment guide's shutdown
section describes. It returns `200` while `server.isReady()` is true and
`503` once a `SIGTERM` starts the shutdown sequence. Cloud Run sends
`SIGTERM` before removing a revision from traffic. Wiring a readiness probe
to this path lets Cloud Run stop routing new requests during the grace period
instead of only during a hard stop.

## Static assets

Nothing in the image expects a persistent volume. `dist/client` bundles the
browser build's route chunks, styles, and `demiurge-manifest.json` directly
into the image at build time. The Node static handler serves them from that
copy. Cloud Run can start, stop, and replace the container at any moment, and
a new instance never inherits a previous instance's filesystem. An application may write files at runtime, but a later request should not
expect to read them back. That request may land on a different container
instance entirely.

## Building and running the example locally

`examples/cloud-run` is buildable without Cloud Run itself:

```sh
docker build -f examples/cloud-run/Dockerfile -t demiurge-cloud-run .
docker run --rm -p 8080:8080 -e PORT=8080 -e ALLOWED_HOSTS=localhost demiurge-cloud-run
curl http://localhost:8080/.well-known/ready
```

The example's README covers this in more detail, including how to prove the
container honors an arbitrary `$PORT` rather than a hardcoded one.
