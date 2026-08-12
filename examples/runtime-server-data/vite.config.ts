import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurge/core/vite";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Runtime Server Data" },
      typedRoutes: true,
    }),
    react(),
  ],
});
