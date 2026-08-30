# Demiurge Object Storage + CDN

This example deploys a Demiurge static build to a private object-storage
origin behind a CDN. It proves the deployment algorithm documented in
[`docs/guides/object-storage-cdn-deployment.md`](../../docs/guides/object-storage-cdn-deployment.md).

```sh
pnpm build
```

writes the static output, including `demiurge-static-manifest.json`, under
`dist/`. `deploy/deploy.ts` reads that output and publishes it:

```sh
BUCKET_ORIGIN=http://127.0.0.1:PORT \
CDN_ORIGIN=http://127.0.0.1:PORT \
BUCKET_READ_SECRET=... BUCKET_WRITE_SECRET=... CDN_ADMIN_SECRET=... \
pnpm deploy
```

`deploy/deploy.ts rollback` restores the previous release.

## What stands in for the cloud

`deploy/bucket-server.ts` and `deploy/cdn-server.ts` are local HTTP servers
that model the two halves of a real deployment target. This is the same way
`examples/cloud-run`'s local Docker build models a container registry rather
than requiring a real cloud account in CI.

**The bucket** accepts a read secret (what a CDN's origin-access identity
would hold) and a write secret (what only the deploy pipeline holds).
Directory listing is refused unconditionally. A request without a valid
secret is refused before the server checks anything else about it.

**The CDN** fetches the manifest and objects from the bucket using the read
secret only. It can never write to the origin, even if it were fully
compromised. It caches every object it serves until `deploy.ts` invalidates
it, and it never talks to the bucket for a request its cache already
answers.

## What to look at, and why

**Upload ordering.** `deploy/deploy.ts` uploads every content-addressed asset
before any mutable file. A page is never live while an asset it references
is still missing from the origin.

**Metadata.** Every object's content type and cache-control header travel
from the manifest, through custom headers on the upload request, to the
object's stored headers. They come back out on every read. These are the
same headers a production host applying the manifest directly would serve.

**Partial-upload safety.** `deploy/deploy.ts` backs up the previous release's
live mutable files before publishing. A mutable upload failure restores every
file this pass already overwrote from that backup before the deploy reports
failure.

**Rollback.** A `rollback` call restores the previous release's mutable files
from the same backup and invalidates the CDN for them.

## Building and testing

```sh
pnpm build
```

`tests/integration/object-storage-cdn.ts` builds this example, starts local
bucket and CDN servers, publishes, and verifies:

- Content-addressed assets upload before the pages that reference them.
- Every served object carries the content type and cache-control header the
  manifest declared.
- The bucket refuses directory listing and refuses a write with only the
  CDN's read secret.
- A second build and deploy republish an updated page. The CDN serves the
  new content only after the deploy invalidates it.
- `rollback` restores the previous release, and the CDN serves it again after
  invalidation.
