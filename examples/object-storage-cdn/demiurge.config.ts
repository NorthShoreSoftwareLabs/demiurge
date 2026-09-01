import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  deployment: {
    static: { origin: "https://static-cdn.example.test" },
  },
  rendering: { document: { title: "Demiurge Object Storage + CDN" } },
  routing: { typedRoutes: true },
});
