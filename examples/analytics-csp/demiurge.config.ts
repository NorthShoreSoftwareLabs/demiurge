import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: { entry: "src/server-entry.ts", outDir: "dist/server" },
  },
  rendering: { document: { title: "Demiurge Analytics CSP" } },
  routing: { typedRoutes: true },
});
