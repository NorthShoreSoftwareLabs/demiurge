import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  rendering: { document: { title: "Application testing example" } },
  routing: { typedRoutes: true },
});
