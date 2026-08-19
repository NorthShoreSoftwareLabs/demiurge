import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { vercelStatic } from "@demiurgejs/core/static";
import { demiurge } from "@demiurgejs/core/vite";
import { fonts } from "./src/fonts";
import { images } from "./src/images";

export default defineConfig({
  plugins: [
    react(),
    demiurge({
      document: {
        title: "Demiurge Static Export",
      },
      fonts,
      images,
      static: {
        deployment: vercelStatic({
          cache: [{
            source: "/site.webmanifest",
            value: "public, max-age=3600",
          }],
        }),
      },
      typedRoutes: true,
    }),
  ],
});
