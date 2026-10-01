import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: { outDir: "dist/server" },
  },
  routing: { typedRoutes: true },
});
