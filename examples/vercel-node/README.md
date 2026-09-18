# Vercel Node example

This example builds a dynamic Demiurge application for a Vercel Node function.

Run `pnpm --filter @demiurge-examples/vercel-node build` from the repository root.
This build writes Vercel Build Output API version 3 files to `.vercel/output`.

Contact routes validate JSON and call an application-owned email boundary.
That boundary renders React email markup and reads its credential at run time.
Replace the example sender with the email service that the application selects.

The generated server entry uses the portable Demiurge request handler.
Vercel packaging and request translation stay in the provider integration.

An integration probe runs the generated function through a local HTTP server.
This probe verifies the packaged artifact without a source tree or repository dependencies.
It does not reproduce Vercel routing, proxy behavior, or production limits.
Verify those items against a deployed preview before production use.
