import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  rendering: { document: { title: "Demiurge Basic Blog" } },
  routing: { typedRoutes: true },
});
