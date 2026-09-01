import { describe, expect, it } from "vitest";
import { unstable_createServerEntrySource as createServerEntrySource } from "@demiurgejs/core/vite";
import { defineEnvSchema, env } from "@demiurgejs/core";

describe("generated server entry environment", () => {
  it("validates the declared schema while the server module loads", () => {
    const source = createServerEntrySource("/application/app", {
      env: defineEnvSchema({
        DATABASE_URL: env.url({ critical: true }),
        FEATURE_FLAG: env.boolean({ optional: true }),
      }),
    });

    expect(source).toContain("unstable_startEnvironment");
    expect(source).toContain("export const env = unstable_startEnvironment(");
    expect(source).toContain('"DATABASE_URL":{"client":false,"critical":true');
    expect(source).toContain('"kind":"url"');
  });

  it("does not add the environment import without a schema", () => {
    const source = createServerEntrySource("/application/app", {});

    expect(source).not.toContain("unstable_startEnvironment");
    expect(source).toContain('import { createRequestHandler } from');
  });
});
