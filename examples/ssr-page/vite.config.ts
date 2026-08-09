import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { demiurge } from "../../src/vite/plugin";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge SSR Page" },
      typedRoutes: true,
    }),
    react(),
  ],
  resolve: {
    alias: {
      demiurge: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      "demiurge/internal/testing": fileURLToPath(
        new URL("../../src/internal/testing.ts", import.meta.url),
      ),
      "demiurge/vite": fileURLToPath(
        new URL("../../src/vite/index.ts", import.meta.url),
      ),
    },
  },
});
