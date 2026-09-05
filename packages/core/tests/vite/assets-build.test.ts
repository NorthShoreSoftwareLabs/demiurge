import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";

test("the default build emits small fonts as files", async () => {
  const root = await mkdtemp(join(tmpdir(), "demiurge-assets-build-"));
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    join(routesDir, "@policy.ts"),
    `import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({ document: security.strict() });`,
  );
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    "export default function NotFound() { return null; }",
  );
  await writeFile(
    join(routesDir, "index.tsx"),
    `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });`,
  );
  await writeFile(
    join(root, "src", "styles.css"),
    `@font-face {
  font-family: "Tiny";
  src: url("./tiny.woff2") format("woff2");
}`,
  );
  await writeFile(join(root, "src", "tiny.woff2"), new Uint8Array(1024));

  try {
    await build({
      build: {
        outDir: join(root, "dist"),
        rollupOptions: { external: ["@demiurgejs/core"] },
      },
      configFile: false,
      logLevel: "silent",
      plugins: [demiurge()],
      root,
    });

    const assetsDir = join(root, "dist", "assets");
    const assets = await readdir(assetsDir);
    const cssFile = assets.find((file) => file.endsWith(".css"));
    const fontFile = assets.find((file) => file.endsWith(".woff2"));

    expect(cssFile).toBeDefined();
    expect(fontFile).toBeDefined();
    const css = await readFile(join(assetsDir, cssFile ?? ""), "utf8");
    expect(css).not.toContain("data:font/woff2");
    expect(css).toContain(fontFile);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
