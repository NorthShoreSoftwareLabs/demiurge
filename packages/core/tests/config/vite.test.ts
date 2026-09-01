import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import {
  createDemiurgeViteConfig,
  toPluginOptions,
} from "../../src/config/vite";
import type { ResolvedDemiurgeConfig } from "../../src/config/types";

const reactPlugin: Plugin = { name: "vite:react" };
const loadReactPlugin = async () => () => reactPlugin;

function config(
  overrides: Partial<ResolvedDemiurgeConfig> = {},
): ResolvedDemiurgeConfig {
  return {
    configFile: "/application/app/demiurge.config.ts",
    root: "/application/app",
    ...overrides,
  };
}

function pluginNames(plugins: unknown) {
  return (plugins as Array<{ name: string }>).map((plugin) => plugin.name);
}

describe("generated Vite configuration", () => {
  it("generates the framework plugins and never reads a Vite configuration file", async () => {
    const generated = await createDemiurgeViteConfig({
      config: config(),
      loadReactPlugin,
    });

    expect(generated.configFile).toBe(false);
    expect(generated.root).toBe("/application/app");
    expect(pluginNames(generated.plugins)).toEqual(["demiurge", "vite:react"]);
  });

  it("merges the supported extension points after the framework plugins", async () => {
    const applicationPlugin: Plugin = { name: "application" };
    const generated = await createDemiurgeViteConfig({
      config: config({
        vite: {
          define: { __BUILD__: '"test"' },
          optimizeDeps: { include: ["lodash"] },
          plugins: [applicationPlugin],
          resolve: { alias: { "~": "/application/app/src" } },
        },
      }),
      loadReactPlugin,
    });

    expect(pluginNames(generated.plugins)).toEqual([
      "demiurge",
      "vite:react",
      "application",
    ]);
    expect(generated.define).toEqual({ __BUILD__: '"test"' });
    expect(generated.optimizeDeps).toEqual({ include: ["lodash"] });
    expect(generated.resolve?.alias).toEqual({ "~": "/application/app/src" });
  });

  it("merges the build overrides of the command", async () => {
    const generated = await createDemiurgeViteConfig({
      config: config({ vite: { define: { __BUILD__: '"test"' } } }),
      loadReactPlugin,
      overrides: {
        build: { outDir: "/application/app/dist" },
        define: { "process.env.NODE_ENV": '"production"' },
        mode: "production",
      },
    });

    expect(generated.mode).toBe("production");
    expect(generated.build?.outDir).toBe("/application/app/dist");
    expect(generated.define).toEqual({
      __BUILD__: '"test"',
      "process.env.NODE_ENV": '"production"',
    });
  });

  it("gives the escape hatch the resolved configuration last", async () => {
    const unstable_viteConfig = vi.fn((resolved) => ({
      ...resolved,
      logLevel: "silent" as const,
    }));
    const generated = await createDemiurgeViteConfig({
      config: config({ unstable_viteConfig }),
      loadReactPlugin,
      overrides: { mode: "production" },
    });

    expect(unstable_viteConfig).toHaveBeenCalledTimes(1);
    expect(unstable_viteConfig.mock.calls[0]![0]).toMatchObject({
      configFile: false,
      mode: "production",
    });
    expect(generated.logLevel).toBe("silent");
  });

  it("fails when the escape hatch does not return a configuration", async () => {
    await expect(createDemiurgeViteConfig({
      // TYPE-EVIDENCE: the callback returns a wrong value on purpose. The cast reaches the runtime check.
      config: config({ unstable_viteConfig: (() => undefined) as never }),
      loadReactPlugin,
    })).rejects.toThrow(/must return a Vite configuration object/);
  });

  it("reports an absent React plugin", async () => {
    await expect(createDemiurgeViteConfig({
      config: config(),
      loadReactPlugin: async () => {
        throw new Error("Cannot find package");
      },
    })).rejects.toThrow(/@vitejs\/plugin-react/);
  });

  it("maps the configuration boundaries onto the plugin options", () => {
    expect(toPluginOptions({
      assets: { fonts: [] as never },
      deployment: { static: { provider: { headers: [] } as never } },
      devtools: false,
      rendering: { document: { title: "Application" }, styles: false },
      routing: { routesDir: "src/pages", typedRoutes: true },
      security: { staticFileHeaders: [] },
    })).toEqual({
      devtools: false,
      document: { title: "Application" },
      fonts: [],
      routesDir: "src/pages",
      static: { deployment: { headers: [] }, headers: [] },
      styles: false,
      typedRoutes: true,
    });
    expect(toPluginOptions({})).toEqual({});
  });
});
