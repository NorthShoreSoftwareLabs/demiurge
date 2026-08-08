export type EnvSource = Record<string, string | undefined>;

export type EnvValidationIssue = {
  code: "invalid" | "missing";
  key: string;
  message: string;
};

export class EnvValidationError extends Error {
  issues: EnvValidationIssue[];

  constructor(issues: EnvValidationIssue[]) {
    super(formatEnvValidationError(issues));
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export type EnvVariable<T, Optional extends boolean = false> = {
  optional: Optional;
  parse: (key: string, value: string) => T;
  sensitive: boolean;
};

export type EnvSchema = Record<string, EnvVariable<unknown, boolean>>;

export type InferEnvSchema<Schema extends EnvSchema> = {
  [Key in keyof Schema]: Schema[Key] extends EnvVariable<infer Value, infer Optional>
    ? Optional extends true
      ? Value | undefined
      : Value
    : never;
};

type RequiredEnvVariableOptions = {
  optional?: false;
};

type OptionalEnvVariableOptions = {
  optional: true;
};

type EnvVariableOptions = RequiredEnvVariableOptions | OptionalEnvVariableOptions;

type RequiredStringEnvOptions = RequiredEnvVariableOptions & {
  minLength?: number;
};

type OptionalStringEnvOptions = OptionalEnvVariableOptions & {
  minLength?: number;
};

type StringEnvOptions = RequiredStringEnvOptions | OptionalStringEnvOptions;

type RequiredUrlEnvOptions = RequiredEnvVariableOptions & {
  protocols?: readonly string[];
};

type OptionalUrlEnvOptions = OptionalEnvVariableOptions & {
  protocols?: readonly string[];
};

type UrlEnvOptions = RequiredUrlEnvOptions | OptionalUrlEnvOptions;

type RequiredIntegerEnvOptions = RequiredEnvVariableOptions & {
  max?: number;
  min?: number;
};

type OptionalIntegerEnvOptions = OptionalEnvVariableOptions & {
  max?: number;
  min?: number;
};

type IntegerEnvOptions = RequiredIntegerEnvOptions | OptionalIntegerEnvOptions;

export function defineEnvSchema<Schema extends EnvSchema>(schema: Schema) {
  return schema;
}

export function validateEnv<Schema extends EnvSchema>(
  schema: Schema,
  source: EnvSource,
): InferEnvSchema<Schema> {
  const issues: EnvValidationIssue[] = [];
  const values: Partial<Record<keyof Schema, unknown>> = {};

  for (const key of Object.keys(schema) as Array<keyof Schema>) {
    const variable = schema[key];
    const rawValue = source[String(key)];

    if (rawValue === undefined || rawValue === "") {
      if (variable.optional) {
        values[key] = undefined;
        continue;
      }

      issues.push({
        code: "missing",
        key: String(key),
        message: `Environment variable ${String(key)} is required.`,
      });
      continue;
    }

    try {
      values[key] = variable.parse(String(key), rawValue);
    } catch (error) {
      issues.push({
        code: "invalid",
        key: String(key),
        message: error instanceof Error
          ? error.message
          : `Environment variable ${String(key)} is invalid.`,
      });
    }
  }

  if (issues.length) {
    throw new EnvValidationError(issues);
  }

  return values as InferEnvSchema<Schema>;
}

function booleanEnv(options: OptionalEnvVariableOptions): EnvVariable<boolean, true>;
function booleanEnv(options?: RequiredEnvVariableOptions): EnvVariable<boolean, false>;
function booleanEnv(options: EnvVariableOptions = {}) {
  return createVariable(options, false, (key, value) => {
    if (value === "true" || value === "1") {
      return true;
    }

    if (value === "false" || value === "0") {
      return false;
    }

    throw new Error(`Environment variable ${key} must be true, false, 1, or 0.`);
  });
}

function enumEnv<const Values extends readonly [string, ...string[]]>(
  values: Values,
  options: OptionalEnvVariableOptions,
): EnvVariable<Values[number], true>;
function enumEnv<const Values extends readonly [string, ...string[]]>(
  values: Values,
  options?: RequiredEnvVariableOptions,
): EnvVariable<Values[number], false>;
function enumEnv<const Values extends readonly [string, ...string[]]>(
  values: Values,
  options: EnvVariableOptions = {},
) {
  return createVariable(options, false, (key, value) => {
    if (values.includes(value)) {
      return value;
    }

    throw new Error(
      `Environment variable ${key} must be one of: ${values.join(", ")}.`,
    );
  });
}

function integerEnv(options: OptionalIntegerEnvOptions): EnvVariable<number, true>;
function integerEnv(options?: RequiredIntegerEnvOptions): EnvVariable<number, false>;
function integerEnv(options: IntegerEnvOptions = {}) {
  return createVariable(options, false, (key, value) => {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`Environment variable ${key} must be an integer.`);
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`Environment variable ${key} must be a safe integer.`);
    }

    if (options.min !== undefined && parsed < options.min) {
      throw new Error(
        `Environment variable ${key} must be greater than or equal to ${options.min}.`,
      );
    }

    if (options.max !== undefined && parsed > options.max) {
      throw new Error(
        `Environment variable ${key} must be less than or equal to ${options.max}.`,
      );
    }

    return parsed;
  });
}

function secretEnv(options: OptionalStringEnvOptions): EnvVariable<string, true>;
function secretEnv(options?: RequiredStringEnvOptions): EnvVariable<string, false>;
function secretEnv(options: StringEnvOptions = {}) {
  return createVariable(options, true, (key, value) =>
    parseString(key, value, options),
  );
}

function stringEnv(options: OptionalStringEnvOptions): EnvVariable<string, true>;
function stringEnv(options?: RequiredStringEnvOptions): EnvVariable<string, false>;
function stringEnv(options: StringEnvOptions = {}) {
  return createVariable(options, false, (key, value) =>
    parseString(key, value, options),
  );
}

function urlEnv(options: OptionalUrlEnvOptions): EnvVariable<URL, true>;
function urlEnv(options?: RequiredUrlEnvOptions): EnvVariable<URL, false>;
function urlEnv(options: UrlEnvOptions = {}) {
  return createVariable(options, false, (key, value) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new Error(`Environment variable ${key} must be a valid URL.`);
    }

    if (
      options.protocols?.length &&
      !options.protocols.includes(url.protocol)
    ) {
      throw new Error(
        `Environment variable ${key} must use one of these protocols: ${options.protocols.join(", ")}.`,
      );
    }

    return url;
  });
}

export const env = {
  boolean: booleanEnv,
  enum: enumEnv,
  integer: integerEnv,
  secret: secretEnv,
  string: stringEnv,
  url: urlEnv,
};

function createVariable<T>(
  options: EnvVariableOptions,
  sensitive: boolean,
  parse: (key: string, value: string) => T,
): EnvVariable<T, boolean> {
  return {
    optional: options.optional ?? false,
    parse,
    sensitive,
  };
}

function parseString(
  key: string,
  value: string,
  options: StringEnvOptions,
) {
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new Error(
      `Environment variable ${key} must be at least ${options.minLength} characters.`,
    );
  }

  return value;
}

function formatEnvValidationError(issues: EnvValidationIssue[]) {
  if (issues.length === 1) {
    return issues[0].message;
  }

  return `Environment validation failed with ${issues.length} issues.`;
}
