import { performance } from "node:perf_hooks";
import console from "node:console";
import { randomBytes } from "node:crypto";
import { defineRuntimeInstrumentation } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const runtimeInstrumentation = defineRuntimeInstrumentation({
  startSpan({ operation, parent }) {
    const start = performance.now();
    const context = {
      ...parent,
      spanId: randomBytes(8).toString("hex"),
      traceFlags: parent?.traceFlags ?? 1,
      traceId: parent?.traceId ?? randomBytes(16).toString("hex"),
    };
    return {
      context,
      end() {
        console.log(JSON.stringify({ operation, duration: performance.now() - start }));
      },
    };
  },
});

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page }) => createHandler({ ...page, runtimeInstrumentation }),
  runtimeInstrumentation,
  name: "Demiurge observability server",
  port: 4211,
});
