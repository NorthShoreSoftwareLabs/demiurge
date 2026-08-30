import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [
    react(),
    demiurge({
      document: { title: "Demiurge Object Storage + CDN" },
      typedRoutes: true,
    }),
  ],
});
