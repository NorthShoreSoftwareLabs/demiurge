# Request Background Work

A configured server route can schedule best-effort work with `background.run(task)`.
The response does not wait for the task.
Completion is not durable.
A process failure or a shutdown deadline can interrupt accepted work.
Use an external queue when delivery must survive process failure.

## Configure the lifetime

Pass the Node runtime lifetime to the generated handler in your server entry.
Declare the Node adapter so handler construction can check its capabilities.

```ts
import { nodeAdapter, type NodeBuildContext } from "@demiurgejs/core/node";
import { createHandler as createDemiurgeHandler } from "virtual:demiurge/server-entry";

export function createHandler({ page, waitUntil }: NodeBuildContext) {
  return createDemiurgeHandler({
    ...page,
    adapter: nodeAdapter,
    background: {
      waitUntil,
      onError(error) {
        console.error("Application background work failed.", error);
      },
    },
  });
}
```

The Node lifetime callback stays valid when the server starts.
A handler can retain the callback received during construction.

`onError` belongs to the application.
It receives task failures without changing an already returned response.
Keep credentials and private data out of telemetry that your callback exports.

When the adapter lacks `backgroundLifetime`, handler construction rejects the configuration.
The generic edge and static adapters do not provide this capability.
A server without this configuration has no `background` route interface.
Development code must handle that absence explicitly.

## Schedule work

Middleware, page loaders, mutations, and HTTP handlers receive the same optional interface.
Pass a callback to `run` so registration occurs before work starts.
Schedule tasks before the handler returns its response.
A saved interface rejects new tasks after that point.
Capture the values that the task needs before the request ends.
Do not depend on the request signal remaining active after the response.

The [Node example](../../examples/node-server) demonstrates a request task and the configured lifetime.
A task failure calls the application error handler.
A runtime background span links to the scheduling context when instrumentation is configured.

## Shutdown

Node waits for registered tasks during graceful shutdown, within its configured deadline.
A response can complete while its task remains pending.
Neither a successful response nor task registration proves completion.
This API provides no retry policy, deduplication, persistent job identifier, or delivery acknowledgment.
