import { describe, expect, it } from "vitest";
import { env } from "../../src/security/env";
import {
  DemiurgeConfigError,
  validateDemiurgeConfig,
} from "../../src/config/validate";

const configFile = "/application/app/demiurge.config.ts";

function validate(value: unknown) {
  return () => validateDemiurgeConfig(value, configFile);
}

describe("Demiurge configuration validation", () => {
  it("accepts a configuration that uses each boundary", () => {
    const config = validateDemiurgeConfig(
      {
        assets: { fonts: [], images: {} },
        deployment: {
          outDir: "dist/client",
          server: { entry: "src/server-entry.ts", outDir: "dist/server" },
          static: { origin: "https://example.test" },
        },
        devtools: false,
        env: { DATABASE_URL: env.string() },
        rendering: { document: { title: "Application" }, styles: false },
        routing: { routesDir: "src/routes", typedRoutes: { outputFile: "types.d.ts" } },
        security: { staticFileHeaders: [] },
        vite: { define: {}, plugins: [] },
      },
      configFile,
    );

    expect(config.deployment?.server?.entry).toBe("src/server-entry.ts");
  });

  it("names the file and the field of an unknown option", () => {
    expect(validate({ routes: {} })).toThrow(DemiurgeConfigError);
    expect(validate({ routes: {} })).toThrow(/field: routes/);
    expect(validate({ routes: {} })).toThrow(new RegExp(`file: ${configFile}`));
    expect(validate({ routing: { routeDir: "src" } }))
      .toThrow(/field: routing.routeDir/);
    expect(validate({ routing: { routeDir: "src" } }))
      .toThrow(/known options: locales, routesDir, typedRoutes/);
  });

  it("names the field and the received value of a wrong type", () => {
    expect(validate({ routing: { routesDir: 42 } }))
      .toThrow(/field: routing.routesDir[\s\S]*must be a string[\s\S]*received: 42/);
    expect(validate({ rendering: { styles: 1 } }))
      .toThrow(/must be false or a string/);
    expect(validate({ devtools: "yes" })).toThrow(/field: devtools/);
    expect(validate({ security: { staticFileHeaders: {} } }))
      .toThrow(/an array of header rules/);
    expect(validate({ vite: { plugins: {} } }))
      .toThrow(/an array of Vite plugins/);
    expect(validate({ assets: { fonts: {} } }))
      .toThrow(/an array of font declarations/);
  });

  it("requires an application server entry when the section exists", () => {
    expect(validate({ deployment: { server: {} } }))
      .toThrow(/field: deployment.server.entry/);
    expect(validate({ deployment: { server: { entry: "" } } }))
      .toThrow(/field: deployment.server.entry/);
  });

  it("requires environment variables from the schema builders", () => {
    expect(validate({ env: { DATABASE_URL: "postgres://localhost" } }))
      .toThrow(/field: env.DATABASE_URL[\s\S]*env.string\(\)/);
  });

  it("rejects a default export that is not a configuration object", () => {
    expect(validate([])).toThrow(/the default export must be a configuration object/);
    expect(validate("config")).toThrow(/received: "config"/);
    expect(validate({ unstable_viteConfig: {} })).toThrow(/must be a function/);
  });
});
