#!/usr/bin/env node

/* global console, process */

import { resolve } from "node:path";
import {
  helpText,
  parseCliArguments,
  resolvePreviewOutputDirectory,
  runBuild,
  runDev,
  runInspectCommand,
  runStart,
} from "../dist/cli.js";
import { loadDemiurgeConfig } from "../dist/config/index.js";
import {
  createStaticPreviewServer,
} from "../dist/static/index.js";

async function main() {
  const commandArguments = process.argv.slice(2);

  // The inspect command owns its exit codes and its problem document, so it
  // runs before the shared argument parser and the shared configuration load.
  if (commandArguments[0] === "inspect") {
    const result = await runInspectCommand({
      arguments: commandArguments.slice(1),
      loadConfig: () => loadDemiurgeConfig(),
    });
    console.error(result.stderr);
    console.log(result.stdout);
    process.exitCode = result.exitCode;
    return;
  }

  const options = parseCliArguments(commandArguments, process.env);

  if (options.command === "help") {
    console.log(helpText);
    return;
  }

  const config = await loadDemiurgeConfig();

  if (options.command === "dev") {
    const server = await runDev(options, config);
    server.printUrls();
    return;
  }

  if (options.command === "build") {
    const result = await runBuild(options, config);
    console.log(`Demiurge generated client output in ${result.outDir}.`);
    if (result.serverOutDir) {
      console.log(`Demiurge generated server output in ${result.serverOutDir}.`);
    }
    if (result.manifest) {
      console.log(
        `Demiurge generated ${result.manifest.entries.length} static artifacts in ${result.outDir}.`,
      );
    }
    if (result.deploymentOutDir) {
      console.log(`Demiurge generated provider output in ${result.deploymentOutDir}.`);
    }
    return;
  }

  if (options.command === "start") {
    await runStart(options, config);
    return;
  }

  const outDir = resolvePreviewOutputDirectory(
    config.root,
    options.outDir,
    config.deployment?.outDir,
  );
  const server = await createStaticPreviewServer({ ...options, outDir });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  console.log(`Demiurge serves ${resolve(outDir)} at http://${options.host}:${port}.`);

  const close = () => server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error) => {
  console.error(`demiurge: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
