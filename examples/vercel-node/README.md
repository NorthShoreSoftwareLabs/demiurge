# Vercel Node example

This example builds a hybrid Demiurge application for Vercel.
Vercel serves the prerendered `/about` document from its static file system.
The Node function serves runtime pages, navigation data, API routes, and mutations.

Run `pnpm --filter @demiurge-examples/vercel-node build` from the repository root.
This build writes Vercel Build Output API version 3 files to `.vercel/output`.

Contact routes validate JSON and call an application-owned email boundary.
That boundary renders React email markup and reads its credential at run time.
Replace the example sender with the email service that the application selects.

The generated server entry uses the portable Demiurge request handler.
Vercel packaging and request translation stay in the provider integration.

An integration probe simulates the generated filesystem and function route order.
This probe verifies the packaged artifact without source files or repository dependencies.
It does not reproduce Vercel proxy behavior or production limits.
Verify those items against a deployed preview before production use.
