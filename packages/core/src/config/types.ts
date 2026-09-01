import type { PluginOption, UserConfig as ViteUserConfig } from "vite";
import type { FontContribution } from "../platform/fonts";
import type { ImagePolicy } from "../platform/images";
import type { LocaleConfiguration } from "../routing";
import type { EnvSchema } from "../security/env";
import type {
  StaticFileHeaderPatternRule,
  VercelStaticDeployment,
} from "../static";

// The routes that the application publishes and the locales that select them.
export type DemiurgeRoutingConfig = {
  locales?: LocaleConfiguration;
  routesDir?: string;
  typedRoutes?: boolean | {
    outputFile?: string;
  };
};

// The document and style contributions that the framework renders.
export type DemiurgeRenderingConfig = {
  document?: {
    lang?: string;
    title?: string;
  };
  styles?: false | string;
};

// The declarations that the framework verifies and publishes as policy.
export type DemiurgeSecurityConfig = {
  staticFileHeaders?: readonly StaticFileHeaderPatternRule[];
};

// The self-hosted fonts and the image policy of the application.
export type DemiurgeAssetsConfig = {
  fonts?: FontContribution;
  images?: ImagePolicy;
};

// The application server entry that a host runs.
export type DemiurgeServerDeploymentConfig = {
  entry: string;
  outDir?: string;
};

// The static output that a file host or an object store publishes.
export type DemiurgeStaticDeploymentConfig = {
  origin?: string;
  provider?: VercelStaticDeployment;
};

export type DemiurgeDeploymentConfig = {
  outDir?: string;
  server?: DemiurgeServerDeploymentConfig;
  static?: DemiurgeStaticDeploymentConfig;
};

// The supported merge points of the generated Vite configuration.
export type DemiurgeViteExtension = {
  define?: Record<string, unknown>;
  optimizeDeps?: ViteUserConfig["optimizeDeps"];
  plugins?: PluginOption[];
  resolve?: {
    alias?: NonNullable<ViteUserConfig["resolve"]>["alias"];
  };
};

export type DemiurgeConfig = {
  assets?: DemiurgeAssetsConfig;
  deployment?: DemiurgeDeploymentConfig;
  // The route audit panel of the development server. The panel is available by
  // default. Set this option to false to remove the endpoint.
  devtools?: boolean;
  env?: EnvSchema;
  rendering?: DemiurgeRenderingConfig;
  routing?: DemiurgeRoutingConfig;
  security?: DemiurgeSecurityConfig;
  vite?: DemiurgeViteExtension;
  // This callback receives the resolved Vite configuration of the framework.
  // It is a framework internal. It has no compatibility guarantee between
  // Demiurge versions.
  unstable_viteConfig?: (
    config: ViteUserConfig,
  ) => ViteUserConfig | Promise<ViteUserConfig>;
};

export type ResolvedDemiurgeConfig = DemiurgeConfig & {
  configFile: string;
  root: string;
};
