import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page }) => createHandler(page),
  name: "Demiurge conditional script server",
  port: 4195,
});
