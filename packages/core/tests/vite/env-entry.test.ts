import { describe, expect, it } from "vitest";
import {
  unstable_createClientEntrySource as createClientEntrySource,
  unstable_createServerEntrySource as createServerEntrySource,
} from "@demiurgejs/core/vite";
import { defineEnvSchema, env } from "@demiurgejs/core";

describe("generated server entry environment", () => {
  it("validates the declared schema while the server module loads", () => {
    const source = createServerEntrySource("/application/app", {
      env: defineEnvSchema({
        DATABASE_URL: env.url(),
        FEATURE_FLAG: env.boolean({ optional: true }),
      }),
    });

    expect(source).toContain("unstable_startEnvironment");
    expect(source).toContain("export const env = unstable_startEnvironment(");
    expect(source).toContain('"DATABASE_URL":{"client":false,"deferred":false');
    expect(source).toContain('"kind":"url"');
  });

  it("does not add the environment import without a schema", () => {
    const source = createServerEntrySource("/application/app", {});

    expect(source).not.toContain("unstable_startEnvironment");
    expect(source).toContain('import { createRequestHandler } from');
  });
});

describe("generated client entry environment", () => {
  const schema = defineEnvSchema({
    PUBLIC_API_URL: env.url({ client: true }),
    SESSION_SECRET: env.secret(),
  });

  it("gives the browser the values of the client variables", () => {
    const source = createClientEntrySource("/application/app", { env: schema }, {
      PUBLIC_API_URL: "https://api.example.test",
      SESSION_SECRET: "a-secret-value-of-the-server",
    });

    expect(source).toContain("unstable_startEnvironment");
    expect(source).toContain('"PUBLIC_API_URL":{"client":true');
    expect(source).toContain('{"PUBLIC_API_URL":"https://api.example.test"}');
    expect(source).not.toContain("SESSION_SECRET");
    expect(source.indexOf("unstable_startEnvironment("))
      .toBeLessThan(source.indexOf("hydrateFileRouter({"));
  });

  it("does not add the environment import without a client variable", () => {
    const source = createClientEntrySource("/application/app", {
      env: defineEnvSchema({ SESSION_SECRET: env.secret() }),
    }, {});

    expect(source).not.toContain("unstable_startEnvironment");
  });

  it("refuses a build without the value of a required client variable", () => {
    const required = defineEnvSchema({
      PUBLIC_API_URL: env.url({ client: true }),
    });

    expect(() => createClientEntrySource("/application/app", { env: required }, {}))
      .toThrow(/required client variable/);
  });

  it("refuses a build with an invalid value of a client variable", () => {
    const invalid = defineEnvSchema({
      PUBLIC_API_URL: env.url({ client: true }),
    });

    expect(() =>
      createClientEntrySource("/application/app", { env: invalid }, {
        PUBLIC_API_URL: "not a url",
      })
    ).toThrow(/invalid client variable/);
  });
});
