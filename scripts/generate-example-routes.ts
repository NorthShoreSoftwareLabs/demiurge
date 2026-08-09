import { resolve } from "node:path";
import { generateRoutes } from "../packages/demiurge/src/routing/generate";

const examples = ["basic-blog", "ssr-page"];

for (const example of examples) {
  await generateRoutes({
    outputFile: resolve(`examples/${example}/.demiurge/route-manifest.d.ts`),
    routesDir: resolve(`examples/${example}/src/routes`),
  });
}
