import type { DemiurgeConfig } from "./types";

export class DemiurgeConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DemiurgeConfigError";
  }
}

const CONFIG_KEYS = [
  "assets",
  "deployment",
  "devtools",
  "env",
  "rendering",
  "routing",
  "security",
  "unstable_viteConfig",
  "vite",
] as const;

const SECTION_KEYS: Record<string, readonly string[]> = {
  assets: ["fonts", "images"],
  deployment: ["outDir", "server", "static"],
  "deployment.server": ["entry", "outDir"],
  "deployment.static": ["origin", "provider"],
  rendering: ["document", "styles"],
  "rendering.document": ["lang", "title"],
  routing: ["locales", "routesDir", "typedRoutes"],
  security: ["staticFileHeaders"],
  vite: ["define", "optimizeDeps", "plugins", "resolve"],
  "vite.resolve": ["alias"],
};

export function validateDemiurgeConfig(
  value: unknown,
  configFile: string,
): DemiurgeConfig {
  const context = { configFile };
  assertPlainObject(context, "", value, "a configuration object");
  const config = value as Record<string, unknown>;
  assertKnownKeys(context, "", config, CONFIG_KEYS);

  const routing = section(context, config, "routing");
  if (routing) {
    assertOptionalString(context, "routing.routesDir", routing.routesDir);
    assertOptionalObject(context, "routing.locales", routing.locales);
    assertTypedRoutes(context, routing.typedRoutes);
  }

  const rendering = section(context, config, "rendering");
  if (rendering) {
    const document = section(context, rendering, "document", "rendering.");
    if (document) {
      assertOptionalString(context, "rendering.document.lang", document.lang);
      assertOptionalString(context, "rendering.document.title", document.title);
    }
    if (
      rendering.styles !== undefined &&
      rendering.styles !== false &&
      typeof rendering.styles !== "string"
    ) {
      throw invalid(context, "rendering.styles", "false or a string", rendering.styles);
    }
  }

  const security = section(context, config, "security");
  if (security && security.staticFileHeaders !== undefined) {
    if (!Array.isArray(security.staticFileHeaders)) {
      throw invalid(
        context,
        "security.staticFileHeaders",
        "an array of header rules",
        security.staticFileHeaders,
      );
    }
  }

  const assets = section(context, config, "assets");
  if (assets) {
    assertOptionalObject(context, "assets.fonts", assets.fonts);
    assertOptionalObject(context, "assets.images", assets.images);
  }

  const deployment = section(context, config, "deployment");
  if (deployment) {
    assertOptionalString(context, "deployment.outDir", deployment.outDir);
    const server = section(context, deployment, "server", "deployment.");
    if (server) {
      if (typeof server.entry !== "string" || !server.entry) {
        throw invalid(
          context,
          "deployment.server.entry",
          "a path to the application server entry",
          server.entry,
        );
      }
      assertOptionalString(context, "deployment.server.outDir", server.outDir);
    }
    const staticDeployment = section(
      context,
      deployment,
      "static",
      "deployment.",
    );
    if (staticDeployment) {
      assertOptionalString(
        context,
        "deployment.static.origin",
        staticDeployment.origin,
      );
      assertOptionalObject(
        context,
        "deployment.static.provider",
        staticDeployment.provider,
      );
    }
  }

  if (config.devtools !== undefined && typeof config.devtools !== "boolean") {
    throw invalid(context, "devtools", "a boolean", config.devtools);
  }

  assertEnvSchema(context, config.env);

  const vite = section(context, config, "vite");
  if (vite) {
    if (vite.plugins !== undefined && !Array.isArray(vite.plugins)) {
      throw invalid(context, "vite.plugins", "an array of Vite plugins", vite.plugins);
    }
    assertOptionalObject(context, "vite.define", vite.define);
    assertOptionalObject(context, "vite.optimizeDeps", vite.optimizeDeps);
    section(context, vite, "resolve", "vite.");
  }

  if (
    config.unstable_viteConfig !== undefined &&
    typeof config.unstable_viteConfig !== "function"
  ) {
    throw invalid(
      context,
      "unstable_viteConfig",
      "a function",
      config.unstable_viteConfig,
    );
  }

  // TYPE-EVIDENCE: each field above matches the declared type or throws. The cast records that result.
  return config as DemiurgeConfig;
}

type ValidationContext = {
  configFile: string;
};

function section(
  context: ValidationContext,
  parent: Record<string, unknown>,
  key: string,
  prefix = "",
) {
  const value = parent[key];
  if (value === undefined) return undefined;
  const field = `${prefix}${key}`;
  assertPlainObject(context, field, value, "an object");
  const record = value as Record<string, unknown>;
  const known = SECTION_KEYS[field];
  if (known) assertKnownKeys(context, field, record, known);
  return record;
}

function assertKnownKeys(
  context: ValidationContext,
  field: string,
  value: Record<string, unknown>,
  known: readonly string[],
) {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    throw new DemiurgeConfigError(
      [
        "Demiurge configuration is invalid.",
        `  file: ${context.configFile}`,
        `  field: ${field ? `${field}.${key}` : key}`,
        "  problem: this option does not exist",
        `  known options: ${known.join(", ")}`,
      ].join("\n"),
    );
  }
}

function assertPlainObject(
  context: ValidationContext,
  field: string,
  value: unknown,
  expected: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(context, field, expected, value);
  }
}

function assertOptionalString(
  context: ValidationContext,
  field: string,
  value: unknown,
) {
  if (value !== undefined && typeof value !== "string") {
    throw invalid(context, field, "a string", value);
  }
}

function assertOptionalObject(
  context: ValidationContext,
  field: string,
  value: unknown,
) {
  if (value === undefined) return;
  assertPlainObject(context, field, value, "an object");
}

function assertTypedRoutes(context: ValidationContext, value: unknown) {
  if (value === undefined || typeof value === "boolean") return;
  assertPlainObject(context, "routing.typedRoutes", value, "a boolean or an object");
  const record = value as Record<string, unknown>;
  assertKnownKeys(context, "routing.typedRoutes", record, ["outputFile"]);
  assertOptionalString(context, "routing.typedRoutes.outputFile", record.outputFile);
}

function assertEnvSchema(context: ValidationContext, value: unknown) {
  if (value === undefined) return;
  assertPlainObject(context, "env", value, "an environment schema");
  for (const [key, variable] of Object.entries(value as Record<string, unknown>)) {
    if (
      variable &&
      typeof variable === "object" &&
      "parse" in variable &&
      typeof (variable as { parse: unknown }).parse === "function"
    ) {
      continue;
    }
    throw invalid(
      context,
      `env.${key}`,
      "a variable from the env builders, such as env.string()",
      variable,
    );
  }
}

function invalid(
  context: ValidationContext,
  field: string,
  expected: string,
  value: unknown,
) {
  return new DemiurgeConfigError(
    [
      "Demiurge configuration is invalid.",
      `  file: ${context.configFile}`,
      `  field: ${field || "(the default export)"}`,
      field
        ? `  problem: this option must be ${expected}`
        : `  problem: the default export must be ${expected}`,
      `  received: ${describeValue(value)}`,
    ].join("\n"),
  );
}

export function describeValue(value: unknown) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "function") return "a function";
  if (typeof value === "string") return JSON.stringify(truncate(value));
  if (typeof value === "object") {
    return Array.isArray(value)
      ? `an array with ${value.length} items`
      : `an object with these keys: ${Object.keys(value).join(", ") || "(none)"}`;
  }
  return String(value);
}

function truncate(value: string) {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}
