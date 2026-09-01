import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("stops the start when a critical variable is absent", () => {
    const schema = defineEnvSchema({
      DATABASE_URL: env.url({ critical: true }),
      SESSION_SECRET: env.secret({ critical: true, minLength: 32 }),
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

  it("warns and starts when a required variable is not critical", () => {
    const warn = vi.fn();
    const schema = defineEnvSchema({
      ANALYTICS_TOKEN: env.string(),
      PORT: env.integer({ optional: true }),
    });

    const result = startEnvironment(schema, { source: {}, warn });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ANALYTICS_TOKEN/);
    expect(warn).toHaveBeenCalledWith(result.warnings[0]);
    expect(result.values.ANALYTICS_TOKEN).toBeUndefined();
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
      SESSION_SECRET: env.secret({ critical: true }),
      TIER: env.enum(["free", "paid"], { optional: true }),
    });

    const descriptor = serializeEnvSchema(schema);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(descriptor.SESSION_SECRET).toMatchObject({
      critical: true,
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
    const invalid = startEnvironment(restored, {
      source: {
        ORIGIN: "http://example.test",
        RETRIES: "9",
        SESSION_SECRET: "value",
      },
      warn: () => {},
    });

    expect(invalid.warnings).toHaveLength(2);
    expect(invalid.warnings[0]).toMatch(/protocols: https:/);
    expect(invalid.warnings[1]).toMatch(/less than or equal to 5/);
    expect(() =>
      startEnvironment(restored, { source: { ORIGIN: "https://example.test", RETRIES: "3" } })
    ).toThrow(EnvValidationError);
  });

  it("refuses a secret variable that client code can read", () => {
    expect(() => env.secret({ client: true })).toThrow(/cannot reach client code/);
  });
});

describe("environment startup branches", () => {
  it("reads the process environment and warns through the console by default", () => {
    const schema = defineEnvSchema({ DEMIURGE_TEST_HOME: env.string() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = startEnvironment(schema);
      expect(result.warnings).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);

      process.env.DEMIURGE_TEST_HOME = "present";
      expect(startEnvironment(schema).values.DEMIURGE_TEST_HOME).toBe("present");
    } finally {
      delete process.env.DEMIURGE_TEST_HOME;
      warn.mockRestore();
    }
  });

  it("restores each variable kind from a description", () => {
    const schema = deserializeEnvSchema({
      FLAG: {
        client: true,
        critical: false,
        kind: "boolean",
        optional: false,
        options: {},
        sensitive: false,
      },
      NAME: {
        client: false,
        critical: false,
        kind: "string",
        optional: false,
        options: {},
        sensitive: false,
      },
      RETRIES: {
        client: false,
        critical: false,
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
          critical: false,
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
