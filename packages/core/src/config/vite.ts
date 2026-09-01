import type { InlineConfig, PluginOption, UserConfig } from "vite";
import { demiurge, type DemiurgeVitePluginOptions } from "../vite/plugin";
import type { DemiurgeConfig, ResolvedDemiurgeConfig } from "./types";
import { DemiurgeConfigError } from "./validate";

export type ReactPluginLoader = () => Promise<(...args: never[]) => PluginOption>;

export type CreateDemiurgeViteConfigOptions = {
  config: ResolvedDemiurgeConfig;
  loadReactPlugin?: ReactPluginLoader;
  overrides?: InlineConfig;
};

// The framework generates the Vite configuration from the application
// configuration. Applications do not author a Vite configuration file.
export async function createDemiurgeViteConfig(
  options: CreateDemiurgeViteConfigOptions,
): Promise<InlineConfig> {
  const { config } = options;
  const react = await loadReactPluginOrFail(options.loadReactPlugin);

  const generated: InlineConfig = {
    configFile: false,
    plugins: [
      demiurge(toPluginOptions(config)),
      react(),
      ...(config.vite?.plugins ?? []),
    ],
    root: config.root,
    ...(config.vite?.define ? { define: { ...config.vite.define } } : {}),
    ...(config.vite?.optimizeDeps
      ? { optimizeDeps: config.vite.optimizeDeps }
      : {}),
    ...(config.vite?.resolve?.alias
      ? { resolve: { alias: config.vite.resolve.alias } }
      : {}),
  };

  const merged = options.overrides
    ? await mergeViteConfig(generated, options.overrides)
    : generated;

  if (!config.unstable_viteConfig) return merged;

  const extended = await config.unstable_viteConfig(merged as UserConfig);
  if (!extended || typeof extended !== "object" || Array.isArray(extended)) {
    throw new DemiurgeConfigError(
      [
        "The unstable_viteConfig callback must return a Vite configuration object.",
        `  file: ${config.configFile}`,
      ].join("\n"),
    );
  }

  return extended as InlineConfig;
}

// The plugin keeps the flat option shape. The configuration boundaries map
// onto it here, so the boundaries stay the application-facing contract.
export function toPluginOptions(
  config: DemiurgeConfig,
): DemiurgeVitePluginOptions {
  return {
    ...(config.devtools === undefined ? {} : { devtools: config.devtools }),
    ...(config.rendering?.document
      ? { document: config.rendering.document }
      : {}),
    ...(config.env ? { env: config.env } : {}),
    ...(config.assets?.fonts ? { fonts: config.assets.fonts } : {}),
    ...(config.assets?.images ? { images: config.assets.images } : {}),
    ...(config.routing?.locales ? { locales: config.routing.locales } : {}),
    ...(config.routing?.routesDir
      ? { routesDir: config.routing.routesDir }
      : {}),
    ...(config.deployment?.static?.provider || config.security?.staticFileHeaders
      ? {
        static: {
          ...(config.deployment?.static?.provider
            ? { deployment: config.deployment.static.provider }
            : {}),
          ...(config.security?.staticFileHeaders
            ? { headers: config.security.staticFileHeaders }
            : {}),
        },
      }
      : {}),
    ...(config.rendering?.styles === undefined
      ? {}
      : { styles: config.rendering.styles }),
    ...(config.routing?.typedRoutes === undefined
      ? {}
      : { typedRoutes: config.routing.typedRoutes }),
  };
}

async function mergeViteConfig(base: InlineConfig, overrides: InlineConfig) {
  const { mergeConfig } = await import("vite");
  return mergeConfig(base, overrides) as InlineConfig;
}

async function loadReactPluginOrFail(loader?: ReactPluginLoader) {
  try {
    return await (loader ?? loadReactPlugin)();
  } catch (error) {
    throw new DemiurgeConfigError(
      [
        "Demiurge did not find @vitejs/plugin-react.",
        "  Demiurge generates the Vite configuration and needs the React plugin.",
        "  Add @vitejs/plugin-react to the development dependencies of the application.",
      ].join("\n"),
      { cause: error },
    );
  }
}

async function loadReactPlugin(): Promise<(...args: never[]) => PluginOption> {
  const module = await import("@vitejs/plugin-react");
  // TYPE-EVIDENCE: the package default export is the plugin factory. The cast keeps the factory signature that the generated configuration needs.
  return module.default as unknown as (...args: never[]) => PluginOption;
}
