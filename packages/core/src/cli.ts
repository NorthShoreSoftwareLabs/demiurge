import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig } from "vite";
import { createDemiurgeViteConfig } from "./config/vite";
import type { ResolvedDemiurgeConfig } from "./config/types";
import { parseClientManifest } from "./manifest";
import type { RouteImporter } from "./route";
import {
  generateVercelStaticOutput,
  generateStaticOutput,
  type GenerateStaticOutputOptions,
  type StaticOutputManifest,
} from "./static";

export { parseClientManifest } from "./manifest";
export type { ClientBuildManifest } from "./manifest";

type CliEnvironment = Record<string, string | undefined>;

const cliOptionNames = new Set(["--host", "--origin", "--out-dir", "--port"]);

const CLIENT_ENTRY = "virtual:demiurge/client-entry";
const SERVER_ENTRY = "virtual:demiurge/server-entry";
const DEFAULT_CLIENT_OUT_DIR = "dist";
const DEFAULT_SERVER_OUT_DIR = "dist/server";
const FRAMEWORK_SERVER_OUT_DIR = ".demiurge/server";

export type CliOptions = {
  command: "build" | "dev" | "help" | "preview";
  host: string;
  origin?: string;
  outDir?: string;
  port: number;
};

export type BuildRuntime = {
  build: (config: InlineConfig) => Promise<unknown>;
  createViteConfig: (overrides: InlineConfig) => Promise<InlineConfig>;
  generate: (
    options: GenerateStaticOutputOptions,
  ) => Promise<StaticOutputManifest>;
  importModule: (specifier: string) => Promise<Record<string, unknown>>;
  now: () => number;
  readText: (file: string) => Promise<string>;
};

export type BuildResult = {
  deploymentOutDir?: string;
  manifest?: StaticOutputManifest;
  outDir: string;
  serverOutDir?: string;
};

export function parseCliArguments(
  arguments_: string[],
  environment: CliEnvironment = {},
): CliOptions {
  const command = arguments_[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    return {
      command: "help",
      host: "localhost",
      port: 4173,
    };
  }
  if (command !== "build" && command !== "dev" && command !== "preview") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options: CliOptions = {
    command,
    host: "localhost",
    origin: environment.SITE_ORIGIN,
    port: command === "dev" ? 5173 : 4173,
  };

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--help" || argument === "-h") {
      return { command: "help", host: "localhost", port: 4173 };
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!cliOptionNames.has(name!)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option ${name} requires a value.`);
    }

    if (name === "--host") options.host = value;
    if (name === "--origin") options.origin = value;
    if (name === "--out-dir") options.outDir = value;
    if (name === "--port") {
      const port = Number(value);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
        throw new Error("The server port must be an integer from 0 through 65535.");
      }
      options.port = port;
    }
  }

  return options;
}

export const helpText = `Usage: demiurge <command> [options]

Commands:
  dev                   Start the development server
  build                 Build production output
  preview               Serve static output with its declared headers

Options:
  --host <host>         Set the server host (default: localhost)
  --origin <origin>     Set the build origin (default: SITE_ORIGIN)
  --out-dir <directory> Set the client output directory (default: dist)
  --port <port>         Set the server port (dev: 5173, preview: 4173)
  -h, --help            Show this help

Demiurge reads demiurge.config.ts from the project root.`;

export async function runDev(
  options: CliOptions,
  config: ResolvedDemiurgeConfig,
) {
  const { createServer } = await import("vite");
  const server = await createServer(
    await createDemiurgeViteConfig({
      config,
      overrides: {
        mode: "development",
        server: { host: options.host, port: options.port },
      },
    }),
  );
  await server.listen();
  return server;
}

export async function runBuild(
  options: CliOptions,
  config: ResolvedDemiurgeConfig,
  runtime?: BuildRuntime,
): Promise<BuildResult> {
  const root = config.root;
  const build = runtime?.build ?? (await import("vite")).build;
  const createViteConfig = runtime?.createViteConfig ??
    ((overrides: InlineConfig) => createDemiurgeViteConfig({ config, overrides }));

  const outDir = resolve(
    root,
    options.outDir ?? config.deployment?.outDir ?? DEFAULT_CLIENT_OUT_DIR,
  );
  const frameworkServerOutDir = resolve(root, FRAMEWORK_SERVER_OUT_DIR);

  await validateBuildOutputDirectory(
    root,
    outDir,
    join(root, "public"),
    frameworkServerOutDir,
  );

  await build(
    await createViteConfig({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      mode: "production",
      build: {
        emptyOutDir: true,
        outDir,
        rollupOptions: { input: CLIENT_ENTRY },
      },
    }),
  );

  const applicationServer = config.deployment?.server;
  const serverOutDir = applicationServer
    ? resolve(root, applicationServer.outDir ?? DEFAULT_SERVER_OUT_DIR)
    : undefined;

  if (applicationServer && serverOutDir) {
    await build(
      await createViteConfig({
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        mode: "production",
        build: {
          copyPublicDir: false,
          emptyOutDir: true,
          outDir: serverOutDir,
          rollupOptions: { input: resolve(root, applicationServer.entry) },
          ssr: true,
        },
      }),
    );
  }

  if (!config.deployment?.static) return { outDir, serverOutDir };

  const staticResult = await buildStaticOutput({
    build,
    config,
    createViteConfig,
    frameworkServerOutDir,
    options,
    outDir,
    root,
    runtime,
  });

  return { ...staticResult, outDir, serverOutDir };
}

async function buildStaticOutput({
  build,
  config,
  createViteConfig,
  frameworkServerOutDir,
  options,
  outDir,
  root,
  runtime,
}: {
  build: (config: InlineConfig) => Promise<unknown>;
  config: ResolvedDemiurgeConfig;
  createViteConfig: (overrides: InlineConfig) => Promise<InlineConfig>;
  frameworkServerOutDir: string;
  options: CliOptions;
  outDir: string;
  root: string;
  runtime?: BuildRuntime;
}) {
  await build(
    await createViteConfig({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      mode: "production",
      build: {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: frameworkServerOutDir,
        rollupOptions: {
          input: SERVER_ENTRY,
          output: { entryFileNames: "server-entry.js" },
        },
        ssr: true,
      },
    }),
  );

  const clientManifest = parseClientManifest(
    runtime
      ? await runtime.readText(resolve(outDir, "demiurge-manifest.json"))
      : await readFile(resolve(outDir, "demiurge-manifest.json"), "utf8"),
  );
  const serverEntryUrl = `${
    pathToFileURL(resolve(frameworkServerOutDir, "server-entry.js")).href
  }?build=${runtime?.now() ?? Date.now()}`;
  const serverEntry = runtime
    ? await runtime.importModule(serverEntryUrl)
    : await import(serverEntryUrl);
  if (!isRouteImporterRecord(serverEntry.routes)) {
    throw new Error("The framework server bundle does not export routes.");
  }

  const manifest = await (runtime?.generate ?? generateStaticOutput)({
    fonts: config.assets?.fonts,
    images: config.assets?.images,
    origin: options.origin ?? config.deployment?.static?.origin,
    outDir,
    root,
    routes: serverEntry.routes,
    ssr: clientManifest,
    staticFileHeaders: config.security?.staticFileHeaders ?? [],
  });

  const provider = config.deployment?.static?.provider;
  const deploymentOutDir = provider
    ? await generateVercelStaticOutput({
      deployment: provider,
      manifest,
      outDir,
      projectRoot: root,
    })
    : undefined;

  return { deploymentOutDir, manifest };
}

export function resolvePreviewOutputDirectory(
  root: string,
  outDir: string | undefined,
  configuredOutDir?: string,
) {
  return resolve(root, outDir ?? configuredOutDir ?? DEFAULT_CLIENT_OUT_DIR);
}

export async function validateBuildOutputDirectory(
  root: string,
  outDir: string,
  publicDir: false | string,
  serverOutDir: string,
) {
  const pathFromRoot = relative(root, outDir);
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("The static output directory must be inside the Vite root.");
  }

  if (publicDir && pathsOverlap(outDir, publicDir)) {
    throw new Error("The static output directory must not overlap the Vite public directory.");
  }

  if (pathsOverlap(outDir, serverOutDir)) {
    throw new Error("The static output directory must not overlap the framework server directory.");
  }

  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch (error) {
    if (isMissingPath(error)) return;
    throw error;
  }

  if (
    entries.length &&
    !entries.includes("demiurge-manifest.json") &&
    !entries.includes("demiurge-static-manifest.json")
  ) {
    throw new Error(
      "The static output directory contains files that a Demiurge build did not create.",
    );
  }
}

function isRouteImporterRecord(
  value: unknown,
): value is Record<string, RouteImporter> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((load) => typeof load === "function");
}

function pathsOverlap(left: string, right: string) {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return isSameOrChildPath(fromLeft) || isSameOrChildPath(fromRight);
}

function isSameOrChildPath(pathname: string) {
  return !pathname ||
    (pathname !== ".." && !pathname.startsWith(`..${sep}`) &&
      !isAbsolute(pathname));
}

function isMissingPath(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
