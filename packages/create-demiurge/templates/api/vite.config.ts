import { defineConfig } from "vite";
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [demiurge({ styles: false, typedRoutes: true })],
});
