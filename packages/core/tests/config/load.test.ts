import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  loadDemiurgeConfig,
  resolveConfigFile,
  resolveProjectRoot,
} from "../../src/config/load";
import { DemiurgeConfigError } from "../../src/config/validate";

describe("Demiurge configuration discovery", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "demiurge-config-"));
    await writeFile(join(root, "package.json"), '{ "name": "app" }');
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("resolves the root from the directory that holds the package manifest", async () => {
    const nested = join(root, "src", "routes");
    await mkdir(nested, { recursive: true });

    expect(resolveProjectRoot(nested)).toBe(root);
    expect(resolveConfigFile(root)).toBe(join(root, CONFIG_FILE_NAME));
  });

  it("fails when the configuration file is absent", async () => {
    await expect(loadDemiurgeConfig({ root })).rejects.toThrow(DemiurgeConfigError);
    await expect(loadDemiurgeConfig({ root })).rejects.toThrow(
      /did not find the configuration file/,
    );
    await expect(loadDemiurgeConfig({ root })).rejects.toThrow(/npm create demiurge/);
  });

  it("does not accept the configuration file in a parent directory", async () => {
    const nested = join(root, "app");
    await mkdir(nested);
    await writeFile(join(nested, "package.json"), '{ "name": "nested" }');
    await writeFile(join(root, CONFIG_FILE_NAME), "export default {};");

    await expect(loadDemiurgeConfig({ root: nested })).rejects.toThrow(
      /did not find the configuration file/,
    );
  });

  it("loads a TypeScript configuration file through the framework loader", async () => {
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      [
        "type Config = { routing: { routesDir: string } };",
        "const config: Config = { routing: { routesDir: 'src/pages' } };",
        "export default config;",
      ].join("\n"),
    );

    const config = await loadDemiurgeConfig({ root });

    expect(config.routing?.routesDir).toBe("src/pages");
    expect(config.root).toBe(root);
    expect(config.configFile).toBe(join(root, CONFIG_FILE_NAME));
  });

  it("reports the file when the module throws", async () => {
    await writeFile(join(root, CONFIG_FILE_NAME), "export default {};");

    await expect(
      loadDemiurgeConfig({
        root,
        loadModule: async () => {
          throw new Error("missing import");
        },
      }),
    ).rejects.toThrow(/failed to load[\s\S]*missing import/);
  });

  it("reports a file without a default export", async () => {
    await writeFile(join(root, CONFIG_FILE_NAME), "export const config = {};");

    await expect(
      loadDemiurgeConfig({ root, loadModule: async () => undefined }),
    ).rejects.toThrow(/did not find a default export/);
  });
});
