import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  defineEnvSchema,
  env,
  validateEnv,
} from "@demiurge-js/core";
import type { EnvSchema } from "@demiurge-js/core";

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

  it("treats an absent variable and an empty-string variable as equally missing", () => {
    const schema = defineEnvSchema({
      NODE_ENV: env.enum(["development", "production", "test"]),
    });

    let absentIssues: EnvValidationError["issues"] = [];
    let emptyIssues: EnvValidationError["issues"] = [];

    try {
      validateEnv(schema, {});
    } catch (error) {
      absentIssues = (error as EnvValidationError).issues;
    }

    try {
      validateEnv(schema, { NODE_ENV: "" });
    } catch (error) {
      emptyIssues = (error as EnvValidationError).issues;
    }

    expect(absentIssues).toEqual([
      {
        code: "missing",
        key: "NODE_ENV",
        message: "Environment variable NODE_ENV is required.",
      },
    ]);
    expect(emptyIssues).toEqual(absentIssues);
  });

  it("returns the single failing message directly instead of an aggregate summary", () => {
    const schema = defineEnvSchema({
      NODE_ENV: env.enum(["development", "production", "test"]),
    });

    try {
      validateEnv(schema, { NODE_ENV: "staging" });
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toBe(
        "Environment variable NODE_ENV must be one of: development, production, test.",
      );
    }
  });

  it("returns an aggregate summary message when multiple variables fail", () => {
    const schema = defineEnvSchema({
      NODE_ENV: env.enum(["development", "production", "test"]),
      PORT: env.integer({ min: 1 }),
    });

    try {
      validateEnv(schema, { NODE_ENV: "staging", PORT: "zero" });
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toBe(
        "Environment validation failed with 2 issues.",
      );
    }
  });

  it("falls back to a generic invalid message when a custom parser throws a non-Error value", () => {
    const schema: EnvSchema = {
      CUSTOM: {
        optional: false,
        parse: () => {
          // Intentionally throw a non-Error value to exercise the fallback
          // branch in validateEnv's catch handler.
          throw "boom";
        },
        sensitive: false,
      },
    };

    try {
      validateEnv(schema, { CUSTOM: "value" });
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toEqual([
        {
          code: "invalid",
          key: "CUSTOM",
          message: "Environment variable CUSTOM is invalid.",
        },
      ]);
    }
  });
});

describe("boolean environment variables", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("coerces %s to %s", (raw, expected) => {
    const schema = defineEnvSchema({ FLAG: env.boolean() });

    const values = validateEnv(schema, { FLAG: raw });

    expect(values.FLAG).toBe(expected);
  });

  it("rejects a value that is not true, false, 1, or 0", () => {
    const schema = defineEnvSchema({ FLAG: env.boolean() });

    expect(() => validateEnv(schema, { FLAG: "yes" })).toThrow(
      "Environment variable FLAG must be true, false, 1, or 0.",
    );
  });

  it("treats an absent optional boolean as undefined rather than defaulting to false", () => {
    const schema = defineEnvSchema({ FLAG: env.boolean({ optional: true }) });

    const values = validateEnv(schema, {});

    expect(values.FLAG).toBeUndefined();
  });
});

describe("enum environment variables", () => {
  it("rejects a value outside the declared set and lists the allowed values", () => {
    const schema = defineEnvSchema({
      NODE_ENV: env.enum(["development", "production", "test"]),
    });

    expect(() => validateEnv(schema, { NODE_ENV: "staging" })).toThrow(
      "Environment variable NODE_ENV must be one of: development, production, test.",
    );
  });

  it("is case sensitive when matching against the declared set", () => {
    const schema = defineEnvSchema({
      NODE_ENV: env.enum(["development", "production", "test"]),
    });

    expect(() => validateEnv(schema, { NODE_ENV: "Production" })).toThrow(
      EnvValidationError,
    );
  });
});

describe("integer environment variables", () => {
  it("rejects a decimal string", () => {
    const schema = defineEnvSchema({ PORT: env.integer() });

    expect(() => validateEnv(schema, { PORT: "3.5" })).toThrow(
      "Environment variable PORT must be an integer.",
    );
  });

  it("rejects a value outside the safe integer range", () => {
    const schema = defineEnvSchema({ PORT: env.integer() });

    expect(() => validateEnv(schema, { PORT: "100000000000000000000" })).toThrow(
      "Environment variable PORT must be a safe integer.",
    );
  });

  it("rejects a value below the configured minimum", () => {
    const schema = defineEnvSchema({ PORT: env.integer({ min: 1024 }) });

    expect(() => validateEnv(schema, { PORT: "80" })).toThrow(
      "Environment variable PORT must be greater than or equal to 1024.",
    );
  });

  it("accepts a value exactly at the configured minimum", () => {
    const schema = defineEnvSchema({ PORT: env.integer({ min: 1024 }) });

    const values = validateEnv(schema, { PORT: "1024" });

    expect(values.PORT).toBe(1024);
  });

  it("rejects a value above the configured maximum", () => {
    const schema = defineEnvSchema({ PORT: env.integer({ max: 65_535 }) });

    expect(() => validateEnv(schema, { PORT: "70000" })).toThrow(
      "Environment variable PORT must be less than or equal to 65535.",
    );
  });

  it("accepts a value exactly at the configured maximum", () => {
    const schema = defineEnvSchema({ PORT: env.integer({ max: 65_535 }) });

    const values = validateEnv(schema, { PORT: "65535" });

    expect(values.PORT).toBe(65_535);
  });

  it("accepts a negative integer when no minimum is configured", () => {
    const schema = defineEnvSchema({ OFFSET: env.integer() });

    const values = validateEnv(schema, { OFFSET: "-5" });

    expect(values.OFFSET).toBe(-5);
  });
});

describe("string environment variables", () => {
  it("accepts any non-empty string when no minLength is configured", () => {
    const schema = defineEnvSchema({ LABEL: env.string() });

    const values = validateEnv(schema, { LABEL: "a" });

    expect(values.LABEL).toBe("a");
  });

  it("rejects a string shorter than the configured minLength", () => {
    const schema = defineEnvSchema({ LABEL: env.string({ minLength: 5 }) });

    expect(() => validateEnv(schema, { LABEL: "ab" })).toThrow(
      "Environment variable LABEL must be at least 5 characters.",
    );
  });

  it("accepts a string exactly at the configured minLength", () => {
    const schema = defineEnvSchema({ LABEL: env.string({ minLength: 5 }) });

    const values = validateEnv(schema, { LABEL: "abcde" });

    expect(values.LABEL).toBe("abcde");
  });

  it("does not trim whitespace, so a whitespace-only value is treated as present rather than missing", () => {
    const schema = defineEnvSchema({ LABEL: env.string() });

    const values = validateEnv(schema, { LABEL: "   " });

    expect(values.LABEL).toBe("   ");
  });
});

describe("secret environment variables", () => {
  it("rejects a secret shorter than the configured minLength", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret({ minLength: 12 }),
    });

    expect(() => validateEnv(schema, { SESSION_SECRET: "short" })).toThrow(
      "Environment variable SESSION_SECRET must be at least 12 characters.",
    );
  });

  it("never includes the raw secret value in the validation error message", () => {
    const schema = defineEnvSchema({
      SESSION_SECRET: env.secret({ minLength: 12 }),
    });

    const invalidSecretValue = "hunter2";

    try {
      validateEnv(schema, { SESSION_SECRET: invalidSecretValue });
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      const issueMessage = (error as EnvValidationError).issues[0].message;
      expect(message).not.toContain(invalidSecretValue);
      expect(issueMessage).not.toContain(invalidSecretValue);
      expect(message).toBe(
        "Environment variable SESSION_SECRET must be at least 12 characters.",
      );
    }
  });
});

describe("url environment variables", () => {
  it("rejects a value that is not a syntactically valid URL", () => {
    const schema = defineEnvSchema({ API_ORIGIN: env.url() });

    expect(() => validateEnv(schema, { API_ORIGIN: "not a url" })).toThrow(
      "Environment variable API_ORIGIN must be a valid URL.",
    );
  });

  it("accepts a URL with a non-restricted protocol when no protocols are configured", () => {
    const schema = defineEnvSchema({ API_ORIGIN: env.url() });

    const values = validateEnv(schema, {
      API_ORIGIN: "postgres://user:pass@localhost:5432/db",
    });

    expect(values.API_ORIGIN.protocol).toBe("postgres:");
  });

  it("rejects a well-formed URL whose protocol is not in the allowed list", () => {
    const schema = defineEnvSchema({
      API_ORIGIN: env.url({ protocols: ["https:"] }),
    });

    expect(() =>
      validateEnv(schema, { API_ORIGIN: "http://api.example.com" }),
    ).toThrow(
      "Environment variable API_ORIGIN must use one of these protocols: https:.",
    );
  });
});
