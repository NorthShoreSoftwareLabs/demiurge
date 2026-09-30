import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: { outDir: "dist/server" },
  },
  rendering: { styles: false },
  routing: { typedRoutes: true },
});
