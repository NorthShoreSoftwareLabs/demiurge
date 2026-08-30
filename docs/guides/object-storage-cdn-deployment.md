# Object-Storage and CDN Deployment

The static adapter builds a production app into files under a directory, plus
`demiurge-static-manifest.json`, which names every route's file, headers, and
status. This document describes a provider-neutral algorithm for publishing
that output to an object-storage bucket behind a CDN, and a security boundary
between the two. [`examples/object-storage-cdn`](../../examples/object-storage-cdn)
runs the algorithm against a local stand-in for both.

See the [deployment capability matrix](./deployment-capability-matrix.md) for
what the static adapter proves. See
[`examples/static-export`](../../examples/static-export) for the manifest
shape and a Vercel Build Output API deployment, a different provider
consuming the same manifest.

## Security boundary

The bucket is the origin. The CDN is the delivery layer. They are separate
security boundaries with separate access.

- **The bucket stays private.** Only the CDN's origin-access identity may read
  it, and only the deploy pipeline may write to it. A leaked CDN read
  credential never grants a write. A client can never reach the bucket
  directly.
- **Directory listing is refused unconditionally**, independent of any
  credential. Nothing about a bucket's contents is enumerable from outside the
  deploy pipeline.
- **A partial upload never becomes the active release.** The algorithm backs
  up the previous release's mutable files before publishing. Any upload
  failure restores that backup before the algorithm returns.
- **Framework security and CORS headers travel unchanged.** The manifest
  already carries the exact headers the static adapter computed. The
  deployment layer copies them onto the object's metadata and back onto the
  response. It never recomputes or drops one.

## Two kinds of file

The manifest divides every output file into one of two kinds, and the
algorithm treats them differently.

- **Content-addressed assets** — anything the framework did not list as a
  manifest entry (a hashed script, stylesheet, image, or font). A build
  never reuses a content-addressed name for different bytes. An asset already
  on the origin under that name is always correct, and never needs
  replacing, only adding.
- **Mutable files** — every manifest entry (a page, `404.html`), plus a
  manifest object the deployment publishes. A CDN edge reads that object to
  route requests to the right file without contacting the origin's
  directory, which it is forbidden from listing. Their object key stays the
  same release over release, so a republish overwrites live bytes at a name
  a CDN has already cached under.

## The deployment algorithm

1. **Read and classify.** Load the manifest, and split the build's files into
   content-addressed assets and mutable files, plus the manifest object
   itself.
2. **Back up the live mutable set.** Before uploading anything, read every
   mutable object the previous release published and copy it to a backup
   key. This is what a failed publish or a `rollback` call restores.
3. **Upload assets before pages.** Upload every content-addressed asset,
   skipping one a previous, partially-failed publish already placed. A page
   that references an asset never gets published to a client until that
   asset exists on the origin.
4. **Publish mutable files, or roll back the attempt.** Upload every mutable
   file, including the manifest object last. If any upload fails, restore
   every mutable file this pass already overwrote from the stage 2 backup,
   then report the failure. Either every mutable file in a release goes
   live, or none of the ones this pass touched stay changed.
5. **Remove obsolete mutable files.** Delete a mutable object the new release
   no longer publishes only now, after every new mutable file is confirmed
   live. A content-addressed asset is never deleted this way. An older page
   still on a CDN's edge cache may still reference one, and its name will
   never collide with a future asset's bytes.
6. **Invalidate the CDN.** Clear the CDN's cached copy of every mutable
   object, including the manifest object edge routing depends on. A
   content-addressed asset needs no invalidation. Its name changed if its
   bytes changed, so a stale edge cache entry under the old name simply stops
   being requested.

## Rollback

Rolling back restores the backup stage 2 took during the most recent
publish. Every mutable object the previous release published goes back to
its previous bytes. Any mutable object the rolled-back release had added is
deleted. The CDN is invalidated for the same set of keys. Rollback recovers
one release generation. A pipeline that needs to roll back further keeps
backups from more than one publish.

## What the example does not do

`examples/object-storage-cdn` proves the algorithm against a local HTTP
server standing in for the bucket, and another standing in for the CDN. This
is the same way `examples/cloud-run` proves the container contract against a
local Docker build rather than a real cloud registry. Swapping in a real
bucket and CDN API means replacing the four object functions and the CDN's
invalidation call in `examples/object-storage-cdn/deploy/deploy.ts`. The
six-stage algorithm above does not change.
