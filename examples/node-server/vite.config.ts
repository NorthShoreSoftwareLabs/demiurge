import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";
import { images } from "./src/images";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Node Server" },
      images,
      typedRoutes: true,
    }),
    react(),
  ],
});
