import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The library ships three entries. Everything that is not a relative import
// stays external so consumers resolve React, Vite, and Node builtins from their
// own tree rather than getting a second copy bundled in.
export default defineConfig({
  build: {
    lib: {
      entry: {
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
