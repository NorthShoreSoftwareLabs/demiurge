import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@demiurgejs/core/internal/testing": fileURLToPath(
        new URL("./src/internal/testing.ts", import.meta.url),
      ),
      "@demiurgejs/core/node": fileURLToPath(
        new URL("./src/node/index.ts", import.meta.url),
      ),
      "@demiurgejs/core/static": fileURLToPath(
        new URL("./src/static/index.ts", import.meta.url),
      ),
      "@demiurgejs/core/vite": fileURLToPath(
        new URL("./src/vite/index.ts", import.meta.url),
      ),
      "@demiurgejs/core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
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
        perFile: true,
        statements: 80,
      },
    },
  },
});
