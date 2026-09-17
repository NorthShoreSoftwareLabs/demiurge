import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { VercelNodeDeployment } from "./config";
import { validateVercelNodeDeployment } from "./config";

export type GenerateVercelNodeOutputOptions = {
  clientDir: string;
  deployment: VercelNodeDeployment;
  projectRoot: string;
  serverDir: string;
};

export async function generateVercelNodeOutput(
  options: GenerateVercelNodeOutputOptions,
) {
  validateVercelNodeDeployment(options.deployment);
  const projectRoot = resolve(options.projectRoot);
  const clientDir = resolve(options.clientDir);
  const serverDir = resolve(options.serverDir);
  const outputRoot = resolve(projectRoot, ".vercel/output");

  if (overlaps(outputRoot, clientDir) || overlaps(outputRoot, serverDir)) {
    throw new Error("The Vercel output directory must not overlap a Demiurge build directory.");
  }

  await mkdir(dirname(outputRoot), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputRoot), "output-demiurge-"));
  try {
    const staticDir = join(staging, "static");
    const functionDir = join(staging, "functions", "demiurge.func");
    await cp(clientDir, staticDir, {
      filter: (source) => !isFrameworkManifest(clientDir, source),
      recursive: true,
    });
    await mkdir(functionDir, { recursive: true });
    await cp(serverDir, join(functionDir, "server"), { recursive: true });
    await cp(
      join(clientDir, "demiurge-manifest.json"),
      join(functionDir, "demiurge-manifest.json"),
    );
    await writeFile(join(functionDir, "index.mjs"), createFunctionEntry());
    await copyRuntimePackages(projectRoot, functionDir);
    await writeFile(
      join(functionDir, ".vc-config.json"),
      `${JSON.stringify(createFunctionConfig(options.deployment), null, 2)}\n`,
    );
    await writeFile(
      join(staging, "config.json"),
      `${JSON.stringify(createOutputConfig(), null, 2)}\n`,
    );
    await rm(outputRoot, { force: true, recursive: true });
    await rename(staging, outputRoot);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }

  return outputRoot;
}

export function createFunctionConfig(deployment: VercelNodeDeployment) {
  return {
    handler: "index.mjs",
    launcherType: "Nodejs",
    runtime: deployment.runtime,
    shouldAddHelpers: true,
    supportsCancellation: true,
    supportsResponseStreaming: true,
    ...(deployment.maxDuration === undefined
      ? {}
      : { maxDuration: deployment.maxDuration }),
    ...(deployment.regions === undefined ? {} : { regions: deployment.regions }),
  };
}

export function createOutputConfig() {
  return {
    routes: [
      { handle: "filesystem" },
      { dest: "/demiurge", src: "^/.*$" },
    ],
    version: 3,
  };
}

function createFunctionEntry() {
  return `import { readFile } from "node:fs/promises";
import { createVercelFunction } from "@demiurgejs/core/vercel";
import * as application from "./server/server-entry.js";

const manifest = JSON.parse(await readFile(
  new URL("./demiurge-manifest.json", import.meta.url),
  "utf8",
));

export default createVercelFunction({
  createHandler: application.createHandler,
  manifest,
});
`;
}

async function copyRuntimePackages(projectRoot: string, functionDir: string) {
  const coreSource = join(projectRoot, "node_modules", "@demiurgejs", "core");
  const coreDestination = join(functionDir, "node_modules", "@demiurgejs", "core");
  try {
    await cp(join(coreSource, "dist"), join(coreDestination, "dist"), {
      dereference: true,
      recursive: true,
    });
    await cp(join(coreSource, "package.json"), join(coreDestination, "package.json"));
  } catch (error) {
    throw new Error(
      "Demiurge could not package the Vercel runtime dependency \"@demiurgejs/core\".",
      { cause: error },
    );
  }

  const runtimePackages = [
    [join(projectRoot, "node_modules", "react"), "react"],
    [join(projectRoot, "node_modules", "react-dom"), "react-dom"],
  ] as const;

  for (const [source, name] of runtimePackages) {
    const destination = join(functionDir, "node_modules", name);
    try {
      await cp(source, destination, { dereference: true, recursive: true });
    } catch (error) {
      throw new Error(
        `Demiurge could not package the Vercel runtime dependency ${JSON.stringify(name)}. Install it for the application or the framework.`,
        { cause: error },
      );
    }
  }
}

function isFrameworkManifest(root: string, source: string) {
  const file = relative(root, source).split(sep).join("/");
  return file === "index.html" || file === "demiurge-manifest.json" ||
    file === "demiurge-static-manifest.json";
}

function overlaps(first: string, second: string) {
  return isWithin(first, second) || isWithin(second, first);
}

function isWithin(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
