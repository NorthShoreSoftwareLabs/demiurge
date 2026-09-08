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
};

export type EnvStartupResult = {
  values: Record<string, unknown>;
};

type DeferredEnvEntry = {
  rawValue: string | undefined;
  variable: EnvVariable<unknown, boolean>;
};

// Vite can load the plugin and the application entry from separate package
// bundles. Store the values on registered symbols so both bundles share one
// process-wide environment state.
const environmentState = Symbol.for("demiurge.environmentState");
const deferredEnvironmentState = Symbol.for("demiurge.deferredEnvironmentState");
// TYPE-EVIDENCE: globalThis stores the process-local maps under the registered symbols.
const runtime = globalThis as typeof globalThis & Record<symbol, unknown>;
const initialized = getInitializedEnvironment();
const deferred = getDeferredEnvironment();

function getInitializedEnvironment(): Map<string, unknown> {
  const existing = runtime[environmentState];
  if (existing instanceof Map) return existing;

  const values = new Map<string, unknown>();
  runtime[environmentState] = values;
  return values;
}

function getDeferredEnvironment(): Map<string, DeferredEnvEntry> {
  const existing = runtime[deferredEnvironmentState];
  if (existing instanceof Map) return existing;

  const values = new Map<string, DeferredEnvEntry>();
  runtime[deferredEnvironmentState] = values;
  return values;
}

// The configuration file declares the schema. The build writes this
// description into the generated server entry, because the production process
// does not read the configuration file.
export function serializeEnvSchema(schema: EnvSchema): EnvSchemaDescriptor {
  return Object.fromEntries(
    Object.entries(schema).map(([key, variable]) => [key, {
      client: variable.client,
      deferred: variable.deferred,
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
// required value that is absent or invalid therefore stops the process before
// it accepts traffic. A deferred value postpones its validation to the first
// server access of the value.
export function startEnvironment(
  schema: EnvSchema | EnvSchemaDescriptor,
  options: EnvStartupOptions = {},
): EnvStartupResult {
  const resolved = isEnvSchema(schema) ? schema : deserializeEnvSchema(schema);
  const source = options.source ?? readProcessEnvironment();
  const issues: EnvValidationIssue[] = [];
  const values: Record<string, unknown> = {};

  for (const [key, variable] of Object.entries(resolved)) {
    const rawValue = source[key];

    if (variable.deferred) {
      deferred.set(key, { rawValue, variable });
      continue;
    }

    if (rawValue === undefined || rawValue === "") {
      values[key] = undefined;
      if (variable.optional) continue;
      issues.push({
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
      issues.push({
        code: "invalid",
        key,
        message: error instanceof Error
          ? error.message
          : `Environment variable ${key} is invalid.`,
      });
    }
  }

  if (issues.length) throw new EnvValidationError(issues);

  for (const [key, value] of Object.entries(values)) initialized.set(key, value);

  return { values };
}

// Applications read the validated values with the types that the schema
// declares. This function is server-only. A deferred value validates here, on
// its first access, and reports a clear error that does not contain the value.
export function readEnv<Schema extends EnvSchema>(
  schema: Schema,
): InferEnvSchema<Schema> {
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    if (deferred.has(key)) {
      values[key] = resolveDeferredValue(key);
      continue;
    }

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
  deferred.clear();
}

function resolveDeferredValue(key: string): unknown {
  // TYPE-EVIDENCE: the has check above proves the map holds an entry for this key.
  const entry = deferred.get(key) as DeferredEnvEntry;
  const { rawValue, variable } = entry;

  if (rawValue === undefined || rawValue === "") {
    if (variable.optional) {
      deferred.delete(key);
      initialized.set(key, undefined);
      return undefined;
    }

    throw new Error(
      `Environment variable ${key} is required. Give the variable a value before the code reads it.`,
    );
  }

  let value: unknown;
  try {
    value = variable.parse(key, rawValue);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Environment variable ${key} is invalid.`,
      { cause: error },
    );
  }

  deferred.delete(key);
  initialized.set(key, value);
  return value;
}

function createVariableFromDescriptor(
  key: string,
  descriptor: EnvVariableDescriptor,
): EnvVariable<unknown, boolean> {
  // TYPE-EVIDENCE: serializeEnvSchema wrote these options from a builder call. The cast returns them to the overloaded builder parameter.
  const options = {
    ...descriptor.options,
    client: descriptor.client,
    deferred: descriptor.deferred,
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
