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
  "object-storage-cdn",
  "nested-policies",
  "metadata-blog",
  "sse-feed",
  "admin-route-group",
  "redis-cache-adapter",
  "webhook-security",
  "cache-invalidation",
  "conditional-script",
  "analytics-csp",
  "cors-api",
  "observability",
  "cloud-run",
  "form-interoperability",
];

for (const example of examples) {
  await generateRoutes({
    outputFile: resolve(`examples/${example}/src/route-manifest.d.ts`),
    routesDir: resolve(`examples/${example}/src/routes`),
  });
}
