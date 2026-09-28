# Vercel Node Deployment

Vercel Node Functions run a hybrid Demiurge application in one deployment.
The function serves runtime pages, navigation responses, API routes, and mutations.
Vercel serves browser assets from its static file system.
Vercel also serves prerendered documents from that file system.
The function handles every route that requires request-time work.

Configure the provider in `demiurge.config.ts`:

```ts
import { defineConfig } from "@demiurgejs/core/config";
import { vercelNode } from "@demiurgejs/core/vercel";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: {
      outDir: "dist/server",
      provider: vercelNode({ maxDuration: 60, regions: ["iad1"] }),
    },
    static: { origin: "https://www.example.com" },
  },
});
```

This configuration uses the generated server entry. Add an application server
entry only when it must add server composition. Keep that entry portable. It
receives provider-neutral page options.

```ts
import type { ServerBuildPageOptions } from "@demiurgejs/core/deployment";
import { createHandler as createDemiurgeHandler } from "virtual:demiurge/server-entry";

export function createHandler(options: ServerBuildPageOptions) {
  return createDemiurgeHandler(options);
}
```

The build writes Build Output API version 3 files to `.vercel/output`.
Set the Vercel Framework Preset to `Other`.
Do not set an Output Directory override.

Set `render: { mode: "static" }` on each page that Vercel must prerender.
Set `deployment.static` to enable hybrid output.
Set `deployment.static.origin` to the public application origin.
Use a static document policy on that route.
The build rejects a static page when its policy requires a request-time nonce.
All other routes keep their runtime ownership.

Vercel serves a prerendered document before it calls the function.
Demiurge sends navigation data requests to the function before the filesystem check.
This order keeps client navigation on the shared route and document pipeline.
Mutation methods also reach the function before the filesystem check.

Set `ALLOWED_HOSTS` to each custom domain before deployment.
The runtime also accepts Vercel deployment and production URL environment values.
It rejects a request host that it cannot verify.

Store `RESEND_API_KEY` and other credentials in Vercel environment variables.
Route code reads them only from a server module.
Do not send an email-service credential to the browser.

The function supports document nonces, streaming responses, request cancellation, and repeated response cookies.
Vercel controls function termination and request duration.
The adapter does not claim a process shutdown sequence or durable background work.

Use a durable application queue when work must complete after an invocation ends.
Application code can integrate with Vercel `waitUntil` for best-effort work within one function deadline.
This provider API is outside the portable Demiurge route contract.
Use a shared cache and rate-limit store when requests can reach multiple replicas.

The adapter does not provide Vercel Edge execution, ISR, or WebSocket support.
Runtime responses use `private, no-store` to protect nonce-bearing and private responses.
The provider rejects `security.staticFileHeaders` during the build.
Use an application platform that can serve those browser-asset rules.

See [`examples/vercel-node`](../../examples/vercel-node) for a buildable contact endpoint.
Run a preview deployment before production use.
