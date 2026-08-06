import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@demiurge/router": fileURLToPath(
        new URL("../../src/mini-framework/router.tsx", import.meta.url),
      ),
    },
  },
});
