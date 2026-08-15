#!/usr/bin/env node

/* global console, process */

import { resolve } from "node:path";
import {
  buildStaticSite,
  helpText,
  parseCliArguments,
} from "../dist/cli.js";
import {
  createStaticPreviewServer,
} from "../dist/static/index.js";

async function main() {
  const options = parseCliArguments(process.argv.slice(2), process.env);

  if (options.command === "help") {
    console.log(helpText);
    return;
  }

  if (options.command === "build") {
    const { manifest, outDir } = await buildStaticSite(options);
    console.log(
      `Demiurge generated ${manifest.entries.length} static artifacts in ${outDir}.`,
    );
    return;
  }

  const server = await createStaticPreviewServer(options);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  console.log(`Demiurge serves ${resolve(options.outDir)} at http://${options.host}:${port}.`);

  const close = () => server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error) => {
  console.error(`demiurge: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
