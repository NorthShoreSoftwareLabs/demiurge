import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { demiurge } from "@demiurgejs/core/vite";

describe("Vite development route transforms", () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("loads import.meta when the route imports a meta binding", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "demiurge-import-meta-")),
    );
    const routesDir = join(root, "src", "routes");
    const routeFile = join(routesDir, "index.ts");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      routeFile,
      `import { meta } from "virtual:test-meta";

export const development = import.meta.env.DEV;
export const value = meta("route loaded");
`,
    );

    server = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "test-meta",
          resolveId(id) {
            return id === "virtual:test-meta" ? "\0virtual:test-meta" : null;
          },
          load(id) {
            return id === "\0virtual:test-meta"
              ? "export const meta = (value) => value;"
              : null;
          },
        },
        demiurge({ styles: false }),
      ],
      root,
      server: { middlewareMode: true },
    });

    const route = await server.ssrLoadModule(routeFile);

    expect(route.development).toBe(true);
    expect(route.value).toBe("route loaded");
  });
});
