import { resolve } from "node:path";
import { generateRoutes } from "../packages/core/src/routing/generate";

const examples = [
  "basic-blog",
  "ssr-page",
  "node-server",
  "streaming-page",
  "runtime-server-data",
  "app-owned-fallbacks",
  "static-export",
  "nested-policies",
  "metadata-blog",
  "sse-feed",
  "admin-route-group",
  "redis-cache-adapter",
];

for (const example of examples) {
  await generateRoutes({
    outputFile: resolve(`examples/${example}/.demiurge/route-manifest.d.ts`),
    routesDir: resolve(`examples/${example}/src/routes`),
  });
}
