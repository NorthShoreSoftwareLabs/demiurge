import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "demiurge/internal/testing": fileURLToPath(
        new URL("./src/internal/testing.ts", import.meta.url),
      ),
      "demiurge/node": fileURLToPath(
        new URL("./src/node/index.ts", import.meta.url),
      ),
      "demiurge/static": fileURLToPath(
        new URL("./src/static/index.ts", import.meta.url),
      ),
      "demiurge/vite": fileURLToPath(
        new URL("./src/vite/index.ts", import.meta.url),
      ),
      demiurge: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
