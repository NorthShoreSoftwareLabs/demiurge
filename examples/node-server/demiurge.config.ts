import { defineConfig } from "@demiurgejs/core/config";
import { fonts } from "./src/fonts";
import { images } from "./src/images";
import { locales } from "./src/localization";

export default defineConfig({
  assets: { fonts, images },
  deployment: {
    outDir: "dist/client",
    server: { entry: "src/server-entry.ts", outDir: "dist/server" },
  },
  rendering: { document: { title: "Demiurge Node Server" } },
  routing: { locales, typedRoutes: true },
});
