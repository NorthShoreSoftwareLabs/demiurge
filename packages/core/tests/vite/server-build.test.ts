import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";

test("the server build supports top-level await in server-only route files", async () => {
  const root = await mkdtemp(join(tmpdir(), "demiurge-server-build-"));
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    join(routesDir, "@middleware.ts"),
    `await Promise.resolve();
export const middleware = async ({ next }) => await next();`,
  );
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    "export default function NotFound() { return null; }",
  );
  await writeFile(
    join(routesDir, "@policy.ts"),
    `await Promise.resolve();
export const policy = { access: { public: true } };`,
  );
  await writeFile(
    join(routesDir, "index.tsx"),
    `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });`,
  );
  const serverEntry = join(root, "src", "server-entry.ts");
  await writeFile(
    serverEntry,
    'export { routes } from "virtual:demiurge/server-entry";',
  );

  try {
    await expect(build({
      build: {
        outDir: join(root, "dist"),
        rollupOptions: {
          external: ["@demiurgejs/core"],
          input: serverEntry,
        },
        ssr: serverEntry,
      },
      configFile: false,
      logLevel: "silent",
      plugins: [demiurge({ styles: false })],
      root,
    })).resolves.toBeDefined();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
