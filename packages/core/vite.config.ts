import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// All nonrelative imports stay external. Consumers resolve React, Vite, and
// Node built-ins from their own dependency tree. The bundle does not contain a
// second copy.
export default defineConfig({
  build: {
    lib: {
      entry: {
        "adapter/testing": fileURLToPath(
          new URL("src/adapter/testing.ts", import.meta.url),
        ),
        cli: fileURLToPath(new URL("src/cli.ts", import.meta.url)),
        "config/index": fileURLToPath(
          new URL("src/config/index.ts", import.meta.url),
        ),
        "deployment/testing": fileURLToPath(
          new URL("src/deployment/testing.ts", import.meta.url),
        ),
        "data/testing": fileURLToPath(
          new URL("src/data/testing.ts", import.meta.url),
        ),
        "security/testing": fileURLToPath(
          new URL("src/security/testing.ts", import.meta.url),
        ),
        index: fileURLToPath(new URL("src/index.ts", import.meta.url)),
        "internal/testing": fileURLToPath(
          new URL("src/internal/testing.ts", import.meta.url),
        ),
        "vite/index": fileURLToPath(
          new URL("src/vite/index.ts", import.meta.url),
        ),
        "node/index": fileURLToPath(
          new URL("src/node/index.ts", import.meta.url),
        ),
        "edge/index": fileURLToPath(
          new URL("src/edge/index.ts", import.meta.url),
        ),
        "kv/index": fileURLToPath(
          new URL("src/kv/index.ts", import.meta.url),
        ),
        "redis/index": fileURLToPath(
          new URL("src/redis/index.ts", import.meta.url),
        ),
        "static/index": fileURLToPath(
          new URL("src/static/index.ts", import.meta.url),
        ),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: (id) => !id.startsWith(".") && !id.startsWith("/"),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
    sourcemap: true,
    target: "es2022",
  },
  plugins: [react()],
});
