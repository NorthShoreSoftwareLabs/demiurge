import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig } from "vite";
import type { RouteImporter } from "./route";
import {
  generateStaticOutput,
  type GenerateStaticOutputOptions,
  type StaticOutputManifest,
} from "./static";

type CliEnvironment = Record<string, string | undefined>;

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
  root: string;
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
    if (!new Set(["--host", "--origin", "--out-dir", "--port"]).has(name!)) {
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
  const root = runtime?.root ?? process.cwd();
  const outDir = resolve(root, options.outDir);
  const serverOutDir = resolve(root, ".demiurge/server");
  const build = runtime?.build ?? (await import("vite")).build;

  await build({
    root,
    build: {
      emptyOutDir: true,
      outDir,
      rollupOptions: { input: "virtual:demiurge/client-entry" },
    },
  });
  await build({
    root,
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
    origin: options.origin,
    outDir,
    routes: serverEntry.routes,
    ssr: clientManifest,
  });

  return { manifest, outDir };
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
