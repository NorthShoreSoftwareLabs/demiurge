import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurge/core/vite";

export default defineConfig({
  plugins: [
    react(),
    demiurge({
      document: {
        title: "Demiurge Static Export",
      },
      typedRoutes: true,
    }),
  ],
});
