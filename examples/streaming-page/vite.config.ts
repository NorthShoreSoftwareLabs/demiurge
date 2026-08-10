import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "demiurge/vite";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Streaming SSR" },
      typedRoutes: true,
    }),
    react(),
  ],
});
