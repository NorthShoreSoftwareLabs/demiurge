import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  defineEnvSchema,
  env,
  validateEnv,
} from "demiurge";

describe("environment validation", () => {
  it("parses typed environment variables from an explicit source", () => {
    const schema = defineEnvSchema({
      API_ORIGIN: env.url({ protocols: ["https:"] }),
      DEBUG: env.boolean({ optional: true }),
      NODE_ENV: env.enum(["development", "production", "test"]),
      PORT: env.integer({ min: 1, max: 65_535 }),
      SESSION_SECRET: env.secret({ minLength: 12 }),
    });

    const values = validateEnv(schema, {
      API_ORIGIN: "https://api.example.com",
      NODE_ENV: "production",
      PORT: "443",
      SESSION_SECRET: "not-a-real-secret",
    });

    expect(values.API_ORIGIN).toBeInstanceOf(URL);
    expect(values.API_ORIGIN.origin).toBe("https://api.example.com");
    expect(values.DEBUG).toBeUndefined();
    expect(values.NODE_ENV).toBe("production");
    expect(values.PORT).toBe(443);
    expect(values.SESSION_SECRET).toBe("not-a-real-secret");
  });

  it("reports all missing and invalid variables together", () => {
    const schema = defineEnvSchema({
      API_ORIGIN: env.url({ protocols: ["https:"] }),
      PORT: env.integer({ min: 1 }),
      SESSION_SECRET: env.secret({ minLength: 12 }),
    });

    expect(() =>
      validateEnv(schema, {
        API_ORIGIN: "http://api.example.com",
        PORT: "zero",
      }),
    ).toThrow(EnvValidationError);

    try {
      validateEnv(schema, {
        API_ORIGIN: "http://api.example.com",
        PORT: "zero",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toEqual([
        {
          code: "invalid",
          key: "API_ORIGIN",
          message:
            "Environment variable API_ORIGIN must use one of these protocols: https:.",
        },
        {
          code: "invalid",
          key: "PORT",
          message: "Environment variable PORT must be an integer.",
        },
        {
          code: "missing",
          key: "SESSION_SECRET",
          message: "Environment variable SESSION_SECRET is required.",
        },
      ]);
    }
  });

  it("marks secret variables as sensitive schema entries", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret(),
    });

    expect(schema.SESSION_SECRET.sensitive).toBe(true);
  });
});
