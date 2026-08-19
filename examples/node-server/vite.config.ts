import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";
import { fonts } from "./src/fonts";
import { images } from "./src/images";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Node Server" },
      fonts,
      images,
      typedRoutes: true,
    }),
    react(),
  ],
});
