import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  rendering: { document: { title: "Demiurge SSR Page" } },
  routing: { typedRoutes: true },
});
