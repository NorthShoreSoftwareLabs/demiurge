# Demiurge Cloud Run

This example is [`examples/node-server`](../node-server)'s production shape,
trimmed down and packaged for [Cloud Run](https://cloud.google.com/run). It
builds a client bundle and an SSR server bundle, then serves both through the
production Node adapter. The container reads its listening port from `$PORT`.

See the [Cloud Run deployment guide](../../docs/guides/cloud-run-deployment.md)
for the platform-level explanation of the container shape, port binding,
health checks, and static assets covered here.

## Build and run without Docker

```sh
pnpm build
PORT=8080 HOST=0.0.0.0 ALLOWED_HOSTS=localhost NODE_ENV=production pnpm start
curl http://localhost:8080/.well-known/ready
```

`server.js` binds `0.0.0.0:8080` by default, the address and port Cloud Run
expects a deployed container to answer on. `HOST` and `PORT` are still plain
environment variables. Override them for a different local target.

## Build and run the container

The build context is the monorepo root, because `@demiurgejs/core` is a
sibling workspace package this example depends on through `workspace:*`.

```sh
docker build -f examples/cloud-run/Dockerfile -t demiurge-cloud-run .
docker run --rm -p 8080:8080 -e PORT=8080 -e ALLOWED_HOSTS=localhost demiurge-cloud-run
curl http://localhost:8080/
curl http://localhost:8080/.well-known/ready
```

The image builds `dist/client` and `dist/server` in a `builder` stage, then
`pnpm deploy --prod` resolves the `workspace:*` dependency into real files and
prunes `devDependencies`. A `runtime` stage copies only that pruned output
into a fresh `node:22-alpine` image. The shipped image contains no source
files from the rest of the monorepo.

### Proving the `$PORT` contract

Cloud Run assigns an arbitrary port at deploy time, not always `8080`. Map a
different host port to a different container port to confirm the image reads
`$PORT` rather than assuming a fixed value:

```sh
docker run --rm -p 19090:9090 -e PORT=9090 -e ALLOWED_HOSTS=localhost demiurge-cloud-run
curl http://localhost:19090/.well-known/ready
```

Both commands should return `200`. If the container only ever answered on
`8080`, the second command would time out instead.

## What to look at, and why

**No persistent state.** `server.js` reads `dist/client/demiurge-manifest.json`
once at process start and serves everything else from that same build. The
image never writes application data to disk. Cloud Run can stop, restart, or
replace this container at any point, and every replacement starts from the
same image with nothing carried over.

**The readiness endpoint.** `/.well-known/ready` returns `200` while
`server.isReady()` is true and `503` once a `SIGTERM` starts the shutdown
sequence. Cloud Run's default startup probe is a TCP check against the
container port, so a container that starts at all already passes it. An HTTP
probe pointed at this path can instead confirm the process is not draining
before Cloud Run sends it more traffic.

**`ALLOWED_HOSTS` in a real deployment.** This example runs locally with
`ALLOWED_HOSTS=localhost`, which matches a request to `localhost` on any
port. A real Cloud Run deployment must set this to the service's `*.run.app`
hostname, or to a custom domain mapped to it. Otherwise every request is
rejected as an untrusted host.

## Deploying to Cloud Run

Deploying the built image is out of scope for this sandbox, and this example
does not attempt it. `gcloud run deploy --source` expects its Dockerfile at
the root of the given source directory. This Dockerfile needs the monorepo
root as build context instead, to reach the sibling `packages/core` workspace
package. Build and push the image directly, from the repo root, with the
`gcloud` CLI authenticated against a project:

```sh
docker build -f examples/cloud-run/Dockerfile \
  -t gcr.io/PROJECT_ID/demiurge-cloud-run .
docker push gcr.io/PROJECT_ID/demiurge-cloud-run
gcloud run deploy demiurge-cloud-run \
  --image gcr.io/PROJECT_ID/demiurge-cloud-run \
  --allow-unauthenticated
```

Cloud Run sets `PORT` itself on the deployed revision and reports the
assigned `*.run.app` hostname on success. Set `ALLOWED_HOSTS` to that hostname
as a deployed environment variable before routing real traffic to the
service.
