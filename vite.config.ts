import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "demiurge/internal/testing": fileURLToPath(
        new URL("./src/internal/testing.ts", import.meta.url),
      ),
      demiurge: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
});
