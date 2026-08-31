import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page }) => createHandler(page),
  name: "Demiurge app-owned fallbacks server",
  port: 4193,
});
