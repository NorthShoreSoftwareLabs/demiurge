# Vercel Node Deployment

Vercel Node Functions run a dynamic Demiurge application in one deployment.
The function serves pages, navigation responses, API routes, and mutations.
Vercel serves browser assets from its static file system.
The function renders application documents and handles application endpoints.
It does not yet combine prerendered Demiurge documents with runtime routes.
Issue [#442](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/442) tracks hybrid route ownership.

Configure the provider in `demiurge.config.ts`:

```ts
import { defineConfig } from "@demiurgejs/core/config";
import { vercelNode } from "@demiurgejs/core/vercel";

export default defineConfig({
  deployment: {
    server: {
      provider: vercelNode({ maxDuration: 60, regions: ["iad1"] }),
    },
  },
});
```

This configuration uses the generated server entry. Add an application server entry only when it must add server composition.
Keep that entry portable. It receives the same page context as a Node deployment.

```ts
import type { NodeBuildContext } from "@demiurgejs/core/node";
import { createHandler as createDemiurgeHandler } from "virtual:demiurge/server-entry";

export function createHandler({ page }: NodeBuildContext) {
  return createDemiurgeHandler(page);
}
```

The build writes Build Output API version 3 files to `.vercel/output`.
Set the Vercel Framework Preset to `Other`.
Do not set an Output Directory override.

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

The first integration renders pages at request time.
It does not provide Vercel Edge execution, ISR, WebSocket support, or CDN representation caching.
Runtime responses use `private, no-store` to protect nonce-bearing and private responses.

See [`examples/vercel-node`](../../examples/vercel-node) for a buildable contact endpoint.
Run a preview deployment before production use.
