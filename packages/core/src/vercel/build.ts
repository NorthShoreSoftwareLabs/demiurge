import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { StaticOutputManifest } from "../static";
import type { VercelNodeDeployment } from "./config";
import { validateVercelNodeDeployment } from "./config";

export type VercelNodeStaticOutput = {
  directory: string;
  manifest: StaticOutputManifest;
};

export type GenerateVercelNodeOutputOptions = {
  clientDir: string;
  deployment: VercelNodeDeployment;
  projectRoot: string;
  serverDir: string;
  staticOutput?: VercelNodeStaticOutput;
};

export async function generateVercelNodeOutput(
  options: GenerateVercelNodeOutputOptions,
) {
  validateVercelNodeDeployment(options.deployment);
  const projectRoot = resolve(options.projectRoot);
  const clientDir = resolve(options.clientDir);
  const serverDir = resolve(options.serverDir);
  const staticOutputDir = options.staticOutput
    ? resolve(options.staticOutput.directory)
    : undefined;
  const outputRoot = resolve(projectRoot, ".vercel/output");

  if (
    overlaps(outputRoot, clientDir) ||
    overlaps(outputRoot, serverDir) ||
    (staticOutputDir !== undefined && overlaps(outputRoot, staticOutputDir)) ||
    overlaps(clientDir, serverDir)
  ) {
    throw new Error("Vercel build directories must not overlap.");
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
    if (options.staticOutput && staticOutputDir) {
      await cp(staticOutputDir, staticDir, {
        filter: (source) =>
          isHybridStaticFile(
            staticOutputDir,
            source,
            options.staticOutput!.manifest,
          ),
        recursive: true,
      });
    }
    await mkdir(functionDir, { recursive: true });
    await cp(serverDir, join(functionDir, "server"), { recursive: true });
    await cp(
      join(clientDir, "demiurge-manifest.json"),
      join(functionDir, "demiurge-manifest.json"),
    );
    await writeFile(join(functionDir, "index.mjs"), createFunctionEntry());
    await writeFile(join(functionDir, "package.json"), '{"type":"module"}\n');
    await copyRuntimePackages(projectRoot, functionDir);
    await writeFile(
      join(functionDir, ".vc-config.json"),
      `${JSON.stringify(createFunctionConfig(options.deployment), null, 2)}\n`,
    );
    await writeFile(
      join(staging, "config.json"),
      `${JSON.stringify(createOutputConfig(options.staticOutput?.manifest), null, 2)}\n`,
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

export function createOutputConfig(manifest?: StaticOutputManifest) {
  const routes: Array<Record<string, unknown>> = [
    {
      dest: "/demiurge",
      methods: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      src: "^/.*$",
    },
    {
      dest: "/demiurge",
      has: [{ key: "x-demiurge-navigation", type: "header", value: "data" }],
      methods: ["GET", "HEAD"],
      src: "^/.*$",
    },
  ];

  if (manifest) {
    if (!manifest.origin) {
      throw new Error(
        "Vercel hybrid output requires a build origin to emit access-control-allow-origin. Pass --origin or set deployment.static.origin.",
      );
    }
    for (const entry of manifest.entries) {
      if (entry.status !== 200) continue;
      routes.push({
        dest: `/${entry.file}`,
        headers: {
          ...withoutContentType(entry.headers),
          "access-control-allow-origin": manifest.origin,
        },
        methods: ["GET", "HEAD"],
        src: exactPathPattern(entry.pathname),
      });
    }
  }

  routes.push(
    { handle: "filesystem" },
    { dest: "/demiurge", src: "^/.*$" },
  );

  return {
    routes,
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
  cacheStore: "unavailable",
  createHandler: application.createHandler,
  manifest,
  rateLimitStore: "unavailable",
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

function isHybridStaticFile(
  root: string,
  source: string,
  manifest: StaticOutputManifest,
) {
  const file = relative(resolve(root), source).split(sep).join("/");
  if (
    file === "demiurge-manifest.json" ||
    file === "demiurge-static-manifest.json"
  ) {
    return false;
  }
  return file !== "index.html" ||
    manifest.entries.some((entry) => entry.file === file);
}

function exactPathPattern(pathname: string) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pathname === "/" ? "^/$" : `^${escaped}/?$`;
}

function withoutContentType(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) =>
      name.toLowerCase() !== "content-type"
    ),
  );
}

function overlaps(first: string, second: string) {
  return isWithin(first, second) || isWithin(second, first);
}

function isWithin(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
