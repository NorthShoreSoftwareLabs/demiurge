import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig } from "vite";
import type { FontContribution, ImagePolicy } from "./platform";
import type { RouteImporter } from "./route";
import {
  generateVercelStaticOutput,
  generateStaticOutput,
  type GenerateStaticOutputOptions,
  type StaticFileHeaderPatternRule,
  type StaticOutputManifest,
  type VercelStaticDeployment,
} from "./static";

type CliEnvironment = Record<string, string | undefined>;

const cliOptionNames = new Set(["--host", "--origin", "--out-dir", "--port"]);

export type CliOptions = {
  command: "build" | "help" | "preview";
  host: string;
  origin?: string;
  outDir: string;
  port: number;
};

type StaticBuildRuntime = {
  build: (config: InlineConfig) => Promise<unknown>;
  generate: (
    options: GenerateStaticOutputOptions,
  ) => Promise<StaticOutputManifest>;
  importModule: (specifier: string) => Promise<Record<string, unknown>>;
  now: () => number;
  readText: (file: string) => Promise<string>;
  resolveConfig: () => Promise<{
    plugins?: Array<{
      api?: unknown;
      name: string;
    }>;
    publicDir: false | string;
    root: string;
  }>;
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
      outDir: "dist",
      port: 4173,
    };
  }
  if (command !== "build" && command !== "preview") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options: CliOptions = {
    command,
    host: "localhost",
    origin: environment.SITE_ORIGIN,
    outDir: "dist",
    port: 4173,
  };

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
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
        throw new Error("Preview port must be an integer from 0 through 65535.");
      }
      options.port = port;
    }
  }

  return options;
}

export const helpText = `Usage: demiurge <command> [options]

Commands:
  build                 Build static production output
  preview               Serve static output with its declared headers

Options:
  --host <host>         Set the preview host (default: localhost)
  --origin <origin>     Set the build origin (default: SITE_ORIGIN)
  --out-dir <directory> Set the output directory (default: dist)
  --port <port>         Set the preview port (default: 4173)
  -h, --help            Show this help`;

export async function buildStaticSite(
  options: CliOptions,
  runtime?: StaticBuildRuntime,
) {
  const vite = runtime ? undefined : await import("vite");
  const config = runtime
    ? await runtime.resolveConfig()
    : await vite!.resolveConfig({}, "build", "production", "production");
  const root = config.root;
  const outDir = resolve(root, options.outDir);
  const serverOutDir = resolve(root, ".demiurge/server");
  const build = runtime?.build ?? vite!.build;

  await validateBuildOutputDirectory(
    root,
    outDir,
    config.publicDir,
    serverOutDir,
  );

  await build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    mode: "production",
    build: {
      emptyOutDir: true,
      outDir,
      rollupOptions: { input: "virtual:demiurge/client-entry" },
    },
  });
  await build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    mode: "production",
    build: {
      copyPublicDir: false,
      emptyOutDir: true,
      outDir: serverOutDir,
      rollupOptions: {
        input: "virtual:demiurge/server-entry",
        output: { entryFileNames: "server-entry.js" },
      },
      ssr: true,
    },
  });

  const clientManifest = parseClientManifest(
    runtime
      ? await runtime.readText(resolve(outDir, "demiurge-manifest.json"))
      : await readFile(resolve(outDir, "demiurge-manifest.json"), "utf8"),
  );
  const serverEntryUrl = `${
    pathToFileURL(resolve(serverOutDir, "server-entry.js")).href
  }?build=${runtime?.now() ?? Date.now()}`;
  const serverEntry = runtime
    ? await runtime.importModule(serverEntryUrl)
    : await import(serverEntryUrl);
  if (!isRouteImporterRecord(serverEntry.routes)) {
    throw new Error("The framework server bundle does not export routes.");
  }

  const manifest = await (runtime?.generate ?? generateStaticOutput)({
    fonts: findFontContribution(config.plugins),
    images: findImagePolicy(config.plugins),
    origin: options.origin,
    outDir,
    root,
    routes: serverEntry.routes,
    ssr: clientManifest,
    staticFileHeaders: findStaticFileHeaderPatterns(config.plugins),
  });

  const deployment = findVercelStaticDeployment(config.plugins);
  const deploymentOutDir = deployment
    ? await generateVercelStaticOutput({
      deployment,
      manifest,
      outDir,
      projectRoot: process.cwd(),
    })
    : undefined;

  return { deploymentOutDir, manifest, outDir };
}

export async function resolvePreviewOutputDirectory(
  outDir: string,
  resolveConfig?: () => Promise<{ root: string }>,
) {
  const config = resolveConfig
    ? await resolveConfig()
    : await (await import("vite")).resolveConfig({}, "serve", "production");
  return resolve(config.root, outDir);
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

export function parseClientManifest(source: string) {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("The client build manifest is not valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("clientEntry" in value) ||
    typeof value.clientEntry !== "string" ||
    !("styles" in value) ||
    !Array.isArray(value.styles) ||
    !value.styles.every((style) => typeof style === "string")
  ) {
    throw new Error("The client build manifest has an unsupported format.");
  }
  return { clientEntry: value.clientEntry, styles: value.styles };
}

function isRouteImporterRecord(
  value: unknown,
): value is Record<string, RouteImporter> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((load) => typeof load === "function");
}

function findVercelStaticDeployment(
  plugins: ReadonlyArray<{ api?: unknown; name: string }> | undefined,
): VercelStaticDeployment | undefined {
  return findDemiurgePluginApi(plugins)?.staticDeployment;
}

function findFontContribution(
  plugins: ReadonlyArray<{ api?: unknown; name: string }> | undefined,
): FontContribution | undefined {
  return findDemiurgePluginApi(plugins)?.fonts;
}

function findImagePolicy(
  plugins: ReadonlyArray<{ api?: unknown; name: string }> | undefined,
): ImagePolicy | undefined {
  return findDemiurgePluginApi(plugins)?.images;
}

function findStaticFileHeaderPatterns(
  plugins: ReadonlyArray<{ api?: unknown; name: string }> | undefined,
): readonly StaticFileHeaderPatternRule[] {
  return findDemiurgePluginApi(plugins)?.staticFileHeaders ?? [];
}

function findDemiurgePluginApi(
  plugins: ReadonlyArray<{ api?: unknown; name: string }> | undefined,
) {
  return plugins
    ?.filter((plugin) => plugin.name === "demiurge")
    .map((plugin) => plugin.api)
    .find(isDemiurgePluginApi);
}

function isDemiurgePluginApi(value: unknown): value is {
  demiurge: true;
  fonts?: FontContribution;
  images?: ImagePolicy;
  staticDeployment?: VercelStaticDeployment;
  staticFileHeaders?: readonly StaticFileHeaderPatternRule[];
} {
  return Boolean(value) &&
    value !== null &&
    typeof value === "object" &&
    "demiurge" in value &&
    value.demiurge === true;
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
