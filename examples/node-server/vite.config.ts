import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";
import { locales } from "./src/localization";
import { fonts } from "./src/fonts";
import { images } from "./src/images";

export default defineConfig({
  plugins: [
    demiurge({
      document: { title: "Demiurge Node Server" },
      fonts,
      images,
      locales,
      typedRoutes: true,
    }),
    react(),
  ],
});
