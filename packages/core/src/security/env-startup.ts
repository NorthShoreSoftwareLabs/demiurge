import {
  env,
  EnvValidationError,
  type EnvSchema,
  type EnvSchemaDescriptor,
  type EnvSource,
  type EnvValidationIssue,
  type EnvVariable,
  type EnvVariableDescriptor,
  type InferEnvSchema,
} from "./env";

export type EnvStartupOptions = {
  source?: EnvSource;
  warn?: (message: string) => void;
};

export type EnvStartupResult = {
  values: Record<string, unknown>;
  warnings: string[];
};

const initialized = new Map<string, unknown>();

// The configuration file declares the schema. The build writes this
// description into the generated server entry, because the production process
// does not read the configuration file.
export function serializeEnvSchema(schema: EnvSchema): EnvSchemaDescriptor {
  return Object.fromEntries(
    Object.entries(schema).map(([key, variable]) => [key, {
      client: variable.client,
      critical: variable.critical,
      kind: variable.kind,
      optional: variable.optional,
      options: variable.options,
      sensitive: variable.sensitive,
    }]),
  );
}

export function deserializeEnvSchema(
  descriptor: EnvSchemaDescriptor,
): EnvSchema {
  return Object.fromEntries(
    Object.entries(descriptor).map(([key, variable]) => [
      key,
      createVariableFromDescriptor(key, variable),
    ]),
  );
}

// The server entry calls this function while the module graph loads. A
// critical failure therefore stops the process before it accepts traffic.
export function startEnvironment(
  schema: EnvSchema | EnvSchemaDescriptor,
  options: EnvStartupOptions = {},
): EnvStartupResult {
  const resolved = isEnvSchema(schema) ? schema : deserializeEnvSchema(schema);
  const source = options.source ?? readProcessEnvironment();
  const critical: EnvValidationIssue[] = [];
  const warnings: string[] = [];
  const values: Record<string, unknown> = {};

  for (const [key, variable] of Object.entries(resolved)) {
    const rawValue = source[key];

    if (rawValue === undefined || rawValue === "") {
      values[key] = undefined;
      if (variable.optional) continue;
      record(variable, critical, warnings, {
        code: "missing",
        key,
        message: `Environment variable ${key} is required.`,
      });
      continue;
    }

    try {
      values[key] = variable.parse(key, rawValue);
    } catch (error) {
      values[key] = undefined;
      record(variable, critical, warnings, {
        code: "invalid",
        key,
        message: error instanceof Error
          ? error.message
          : `Environment variable ${key} is invalid.`,
      });
    }
  }

  if (critical.length) throw new EnvValidationError(critical);

  const warn = options.warn ?? defaultWarn;
  for (const warning of warnings) warn(warning);
  for (const [key, value] of Object.entries(values)) initialized.set(key, value);

  return { values, warnings };
}

// Applications read the validated values with the types that the schema
// declares. This function is server-only.
export function readEnv<Schema extends EnvSchema>(
  schema: Schema,
): InferEnvSchema<Schema> {
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    if (!initialized.has(key)) {
      throw new Error(
        `Demiurge did not validate the environment variable ${key}. The framework validates the schema of demiurge.config.ts when the server starts.`,
      );
    }
    values[key] = initialized.get(key);
  }

  // TYPE-EVIDENCE: startEnvironment parsed each value with the same schema. The cast restores the inferred schema type.
  return values as InferEnvSchema<Schema>;
}

export function resetEnvironment() {
  initialized.clear();
}

function record(
  variable: { critical: boolean },
  critical: EnvValidationIssue[],
  warnings: string[],
  issue: EnvValidationIssue,
) {
  if (variable.critical) {
    critical.push(issue);
    return;
  }
  warnings.push(
    `Demiurge started without a valid value for ${issue.key}. ${issue.message} A request that needs this value fails.`,
  );
}

function createVariableFromDescriptor(
  key: string,
  descriptor: EnvVariableDescriptor,
): EnvVariable<unknown, boolean> {
  // TYPE-EVIDENCE: serializeEnvSchema wrote these options from a builder call. The cast returns them to the overloaded builder parameter.
  const options = {
    ...descriptor.options,
    client: descriptor.client,
    critical: descriptor.critical,
    optional: descriptor.optional,
  } as never;

  if (descriptor.kind === "boolean") return env.boolean(options);
  if (descriptor.kind === "integer") return env.integer(options);
  if (descriptor.kind === "secret") return env.secret(options);
  if (descriptor.kind === "url") return env.url(options);
  if (descriptor.kind === "enum") {
    const values = descriptor.options.values;
    if (!Array.isArray(values) || !values.length) {
      throw new Error(
        `The environment variable ${key} does not have the values of its enum.`,
      );
    }
    // TYPE-EVIDENCE: the descriptor keeps the declared enum values. The cast restores the tuple type that the builder needs.
    return env.enum(values as [string, ...string[]], options);
  }
  return env.string(options);
}

function isEnvSchema(
  schema: EnvSchema | EnvSchemaDescriptor,
): schema is EnvSchema {
  return Object.values(schema).every(
    (variable) => "parse" in variable && typeof variable.parse === "function",
  );
}

function readProcessEnvironment(): EnvSource {
  // TYPE-EVIDENCE: the framework runs this function on a server runtime. The cast reads the process environment without a Node type dependency here.
  const runtime = globalThis as { process?: { env?: EnvSource } };
  return runtime.process?.env ?? {};
}

function defaultWarn(message: string) {
  // TYPE-EVIDENCE: a server runtime supplies console. The cast keeps the warning optional.
  const runtime = globalThis as {
    console?: { warn?: (message: string) => void };
  };
  runtime.console?.warn?.(message);
}
