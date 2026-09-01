import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DemiurgeConfig, ResolvedDemiurgeConfig } from "./types";
import { DemiurgeConfigError, validateDemiurgeConfig } from "./validate";

// The framework accepts one configuration file name at one location. It does
// not search parent directories and it does not accept another extension.
export const CONFIG_FILE_NAME = "demiurge.config.ts";

export type ConfigModuleLoader = (file: string) => Promise<unknown>;

export type LoadDemiurgeConfigOptions = {
  loadModule?: ConfigModuleLoader;
  root?: string;
};

// The project root is the directory that holds the package manifest of the
// application. The framework resolves it from the working directory.
export function resolveProjectRoot(from: string = process.cwd()) {
  let directory = resolve(from);

  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(from);
    directory = parent;
  }
}

export function resolveConfigFile(root: string) {
  return join(root, CONFIG_FILE_NAME);
}

export async function loadDemiurgeConfig(
  options: LoadDemiurgeConfigOptions = {},
): Promise<ResolvedDemiurgeConfig> {
  const root = options.root ?? resolveProjectRoot();
  const configFile = resolveConfigFile(root);

  if (!existsSync(configFile)) {
    throw new DemiurgeConfigError(missingConfigMessage(configFile));
  }

  const loadModule = options.loadModule ?? loadConfigModule;
  let exported: unknown;

  try {
    exported = await loadModule(configFile);
  } catch (error) {
    throw new DemiurgeConfigError(
      [
        `Demiurge failed to load ${configFile}.`,
        `  cause: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }

  if (exported === undefined || exported === null) {
    throw new DemiurgeConfigError(
      [
        `Demiurge did not find a default export in ${configFile}.`,
        "  The file must export a Demiurge configuration as its default export.",
        '  Example: export default defineConfig({ routing: { typedRoutes: true } });',
      ].join("\n"),
    );
  }

  const config: DemiurgeConfig = validateDemiurgeConfig(exported, configFile);
  return { ...config, configFile, root };
}

export function missingConfigMessage(configFile: string) {
  return [
    `Demiurge did not find the configuration file ${configFile}.`,
    "  Every Demiurge command needs this file. There is no default configuration.",
    '  Create an application with "npm create demiurge" to generate it.',
  ].join("\n");
}

async function loadConfigModule(configFile: string) {
  const { loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    configFile,
    dirname(configFile),
  );
  return loaded?.config;
}
