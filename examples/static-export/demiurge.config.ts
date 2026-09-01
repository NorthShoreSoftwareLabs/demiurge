import { defineConfig } from "@demiurgejs/core/config";
import { vercelStatic } from "@demiurgejs/core/static";
import { fonts } from "./src/fonts";
import { images } from "./src/images";

export default defineConfig({
  assets: { fonts, images },
  deployment: {
    static: {
      origin: "https://static.example.test",
      provider: vercelStatic({
        cache: [{
          source: "/site.webmanifest",
          value: "public, max-age=3600",
        }],
      }),
    },
  },
  rendering: { document: { title: "Demiurge Static Export" } },
  routing: { typedRoutes: true },
});
