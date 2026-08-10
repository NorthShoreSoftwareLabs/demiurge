/* global console, process */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateStaticOutput } from "demiurge/static";
import { routes } from "./.demiurge/server/server-entry.js";

const outDir = resolve("dist");
const clientManifest = JSON.parse(
  await readFile(resolve(outDir, "demiurge-manifest.json"), "utf8"),
);
const manifest = await generateStaticOutput({
  origin: process.env.SITE_ORIGIN ?? "https://static.example.test",
  outDir,
  routes,
  ssr: {
    clientEntry: clientManifest.clientEntry,
    styles: clientManifest.styles,
  },
});

console.log(`Generated ${manifest.entries.length} static HTML artifacts in dist/.`);
