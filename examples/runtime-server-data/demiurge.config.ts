import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: { entry: "src/server-entry.ts", outDir: "dist/server" },
  },
  rendering: { document: { title: "Demiurge Runtime Server Data" } },
  routing: { typedRoutes: true },
});
