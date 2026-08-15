import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { vercelStatic } from "@demiurgejs/core/static";
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [
    react(),
    demiurge({
      document: {
        title: "Demiurge Static Export",
      },
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
