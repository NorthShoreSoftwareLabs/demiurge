import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurge-js/core/vite";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Node Server" },
      typedRoutes: true,
    }),
    react(),
  ],
});
