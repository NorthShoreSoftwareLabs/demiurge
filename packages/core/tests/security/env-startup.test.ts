import { afterEach, describe, expect, it } from "vitest";
import { defineEnvSchema, env, EnvValidationError } from "../../src/security/env";
import {
  deserializeEnvSchema,
  readEnv,
  resetEnvironment,
  serializeEnvSchema,
  startEnvironment,
} from "../../src/security/env-startup";

afterEach(() => {
  resetEnvironment();
});

describe("environment startup", () => {
  it("stops the start when a required variable is absent", () => {
    const schema = defineEnvSchema({
      DATABASE_URL: env.url(),
      SESSION_SECRET: env.secret({ minLength: 32 }),
    });

    try {
      startEnvironment(schema, { source: { SESSION_SECRET: "short" } });
      throw new Error("expected a startup failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.map((issue) => issue.key))
        .toEqual(["DATABASE_URL", "SESSION_SECRET"]);
    }
  });

  it("stops the start when a required variable is invalid", () => {
    const schema = defineEnvSchema({
      PORT: env.integer({ min: 1 }),
    });

    expect(() => startEnvironment(schema, { source: { PORT: "not-a-number" } }))
      .toThrow(EnvValidationError);
  });

  it("starts when an optional variable is absent", () => {
    const schema = defineEnvSchema({
      ANALYTICS_TOKEN: env.string({ optional: true }),
      PORT: env.integer(),
    });

    const result = startEnvironment(schema, { source: { PORT: "3000" } });

    expect(result.values.ANALYTICS_TOKEN).toBeUndefined();
    expect(result.values.PORT).toBe(3000);
  });

  it("stops the start when a supplied optional variable is invalid", () => {
    const schema = defineEnvSchema({
      ANALYTICS_TOKEN: env.string({ minLength: 8, optional: true }),
    });

    expect(() =>
      startEnvironment(schema, { source: { ANALYTICS_TOKEN: "short" } })
    ).toThrow(EnvValidationError);
  });

  it("starts when a deferred variable is absent, then validates it on the first access", () => {
    const schema = defineEnvSchema({
      QUEUE_URL: env.url({ deferred: true }),
    });

    const result = startEnvironment(schema, { source: {} });
    expect(result.values.QUEUE_URL).toBeUndefined();

    expect(() => readEnv(schema)).toThrow(/QUEUE_URL is required/);
  });

  it("gives applications the validated values with their declared types", () => {
    const schema = defineEnvSchema({
      FEATURE_FLAG: env.boolean(),
      RETRIES: env.integer({ min: 0 }),
      TIER: env.enum(["free", "paid"]),
    });

    startEnvironment(schema, {
      source: { FEATURE_FLAG: "true", RETRIES: "3", TIER: "paid" },
    });

    const values = readEnv(schema);
    expect(values).toEqual({ FEATURE_FLAG: true, RETRIES: 3, TIER: "paid" });
  });

  it("reports a read before the framework validated the schema", () => {
    expect(() => readEnv(defineEnvSchema({ MISSING: env.string() })))
      .toThrow(/did not validate the environment variable MISSING/);
  });

  it("keeps the declaration through a serialization round trip", () => {
    const schema = defineEnvSchema({
      ORIGIN: env.url({ protocols: ["https:"] }),
      RETRIES: env.integer({ max: 5, min: 1 }),
      SESSION_SECRET: env.secret(),
      TIER: env.enum(["free", "paid"], { optional: true }),
    });

    const descriptor = serializeEnvSchema(schema);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(descriptor.SESSION_SECRET).toMatchObject({
      deferred: false,
      kind: "secret",
      sensitive: true,
    });

    const restored = deserializeEnvSchema(descriptor);
    const result = startEnvironment(restored, {
      source: {
        ORIGIN: "https://example.test",
        RETRIES: "3",
        SESSION_SECRET: "value",
      },
    });

    expect(result.values.RETRIES).toBe(3);
    expect(String(result.values.ORIGIN)).toBe("https://example.test/");
    expect(() =>
      startEnvironment(restored, {
        source: {
          ORIGIN: "http://example.test",
          RETRIES: "9",
          SESSION_SECRET: "value",
        },
      })
    ).toThrow(EnvValidationError);
    expect(() =>
      startEnvironment(restored, { source: { ORIGIN: "https://example.test", RETRIES: "3" } })
    ).toThrow(EnvValidationError);
  });

  it("migrates a critical: false declaration to deferred: true", () => {
    // The old default let a required variable warn instead of stop the start.
    // The migration for that declaration is `deferred: true`.
    const schema = defineEnvSchema({
      LEGACY_TOKEN: env.string({ deferred: true }),
    });

    const result = startEnvironment(schema, { source: {} });
    expect(result.values.LEGACY_TOKEN).toBeUndefined();
  });

  it("refuses a secret variable that client code can read", () => {
    expect(() => env.secret({ client: true } as never))
      .toThrow(/cannot reach client code/);
  });

  it("refuses an optional variable that is also deferred", () => {
    expect(() => env.string({ deferred: true, optional: true } as never))
      .toThrow(/optional with deferred/);
  });

  it("refuses a client variable that is also deferred", () => {
    expect(() => env.string({ client: true, deferred: true } as never))
      .toThrow(/client environment variable cannot be deferred/);
  });

  it("keeps a client variable in the schema description", () => {
    const schema = defineEnvSchema({ PUBLIC_API_URL: env.url({ client: true }) });

    expect(serializeEnvSchema(schema).PUBLIC_API_URL.client).toBe(true);
    expect(deserializeEnvSchema(serializeEnvSchema(schema)).PUBLIC_API_URL.client)
      .toBe(true);
  });
});

describe("redaction", () => {
  it("does not put the value of a sensitive variable in a startup error", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret({ minLength: 32 }),
    });
    const secretValue = "too-short";

    try {
      startEnvironment(schema, { source: { SESSION_SECRET: secretValue } });
      throw new Error("expected a startup failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).not.toContain(secretValue);
    }
  });

  it("does not put the value of a sensitive variable in a deferred access error", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret({ deferred: true, minLength: 32 }),
    });
    const secretValue = "too-short";

    startEnvironment(schema, { source: { SESSION_SECRET: secretValue } });

    try {
      readEnv(schema);
      throw new Error("expected a deferred access failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secretValue);
    }
  });

  it("does not put the value of a sensitive variable in the serialized description", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret({ minLength: 32 }),
    });

    const descriptor = serializeEnvSchema(schema);
    expect(JSON.stringify(descriptor)).not.toContain("too-short");
    expect(descriptor.SESSION_SECRET.sensitive).toBe(true);
  });
});

describe("environment startup branches", () => {
  it("reads the process environment by default", () => {
    const schema = defineEnvSchema({ DEMIURGE_TEST_HOME: env.string() });

    try {
      expect(() => startEnvironment(schema)).toThrow(EnvValidationError);

      process.env.DEMIURGE_TEST_HOME = "present";
      expect(startEnvironment(schema).values.DEMIURGE_TEST_HOME).toBe("present");
    } finally {
      delete process.env.DEMIURGE_TEST_HOME;
    }
  });

  it("restores each variable kind from a description", () => {
    const schema = deserializeEnvSchema({
      FLAG: {
        client: false,
        deferred: false,
        kind: "boolean",
        optional: false,
        options: {},
        sensitive: false,
      },
      NAME: {
        client: false,
        deferred: false,
        kind: "string",
        optional: false,
        options: {},
        sensitive: false,
      },
      RETRIES: {
        client: false,
        deferred: false,
        kind: "integer",
        optional: false,
        options: {},
        sensitive: false,
      },
    });

    const result = startEnvironment(schema, {
      source: { FLAG: "1", NAME: "demiurge", RETRIES: "2" },
    });

    expect(result.values).toEqual({ FLAG: true, NAME: "demiurge", RETRIES: 2 });
  });

  it("reports an enum description without its values", () => {
    expect(() =>
      deserializeEnvSchema({
        TIER: {
          client: false,
          deferred: false,
          kind: "enum",
          optional: false,
          options: {},
          sensitive: false,
        },
      })
    ).toThrow(/does not have the values of its enum/);
  });

  it("gives an empty schema no values", () => {
    expect(startEnvironment({}).values).toEqual({});
    expect(serializeEnvSchema({})).toEqual({});
  });
});
