import { resolve } from "node:path";
import { generateRoutes } from "../src/routing/generate";

await generateRoutes({
  outputFile: resolve("examples/basic-blog/src/route-manifest.d.ts"),
  routesDir: resolve("examples/basic-blog/src/routes"),
});
