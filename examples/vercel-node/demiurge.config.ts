import { defineConfig } from "@demiurgejs/core/config";
import { vercelNode } from "@demiurgejs/core/vercel";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: {
      provider: vercelNode({
        maxDuration: 60,
        regions: ["iad1"],
        runtime: "nodejs22.x",
      }),
    },
  },
  rendering: { document: { title: "Demiurge on Vercel" } },
  routing: { typedRoutes: true },
});
