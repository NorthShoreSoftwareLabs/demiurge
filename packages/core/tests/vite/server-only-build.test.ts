import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, expect, test } from "vitest";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createApplication(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-server-only-build-"));
  roots.push(root);
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    "export default function NotFound() { return null; }",
  );

  for (const [file, source] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source);
  }

  return root;
}

const externalSpecifiers = new Set([
  "@demiurgejs/core",
  "@demiurgejs/core/server-only",
  "server-only",
]);

function buildApplication(root: string) {
  return build({
    build: {
      outDir: join(root, "dist"),
      rollupOptions: {
        external: (id) => externalSpecifiers.has(id),
      },
    },
    configFile: false,
    logLevel: "silent",
    plugins: [demiurge({ styles: false })],
    root,
  });
}

test("the build refuses a route that directly imports a server-only module", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import "@demiurgejs/core/server-only";
export function readSecret() {
  return "value";
}`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
import { readSecret } from "../lib/session";
export const GET = page({ view: () => readSecret() });`,
  });

  const failure = await buildApplication(root).catch((error: unknown) => error);
  const message = failure instanceof Error ? failure.message : String(failure);

  expect(message).toContain(join("src", "lib", "session.ts"));
  expect(message).toContain("server-only");
});

test("the build gives the full import path of a transitive read", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import "@demiurgejs/core/server-only";
export function readSecret() {
  return "value";
}`,
    "src/lib/account.ts": `import { readSecret } from "./session";
export function readAccount() {
  return readSecret();
}`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
import { readAccount } from "../lib/account";
export const GET = page({ view: () => readAccount() });`,
  });

  const failure = await buildApplication(root).catch((error: unknown) => error);
  const message = failure instanceof Error ? failure.message : String(failure);

  expect(message).toContain(join("src", "lib", "session.ts"));
  expect(message).toContain(join("src", "lib", "account.ts"));
  expect(message).toContain(join("src", "routes", "index.tsx"));
  expect(message).toContain("client-entry");

  const importPathLine = message.slice(message.indexOf("import path:"));
  const entryIndex = importPathLine.indexOf("client-entry");
  const routeIndex = importPathLine.indexOf(join("src", "routes", "index.tsx"));
  const accountIndex = importPathLine.indexOf(join("src", "lib", "account.ts"));
  const sessionIndex = importPathLine.indexOf(join("src", "lib", "session.ts"));

  expect(entryIndex).toBeGreaterThanOrEqual(0);
  expect(routeIndex).toBeGreaterThan(entryIndex);
  expect(accountIndex).toBeGreaterThan(routeIndex);
  expect(sessionIndex).toBeGreaterThan(accountIndex);
});

test("the build refuses a re-export chain that reaches a server-only module", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import "server-only";
export function readSecret() {
  return "value";
}`,
    "src/lib/reexport.ts": `export { readSecret } from "./session";`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
import { readSecret } from "../lib/reexport";
export const GET = page({ view: () => readSecret() });`,
  });

  const failure = await buildApplication(root).catch((error: unknown) => error);
  const message = failure instanceof Error ? failure.message : String(failure);

  expect(message).toContain(join("src", "lib", "session.ts"));
});

test("the build refuses a dynamic import that reaches a server-only module", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import "@demiurgejs/core/server-only";
export function readSecret() {
  return "value";
}`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
export const GET = page({
  view: () => {
    void import("../lib/session");
    return null;
  },
});`,
  });

  const failure = await buildApplication(root).catch((error: unknown) => error);
  const message = failure instanceof Error ? failure.message : String(failure);

  expect(message).toContain(join("src", "lib", "session.ts"));
});

test("the build accepts a server-only module reached only from the server entry", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import "@demiurgejs/core/server-only";
export function readSecret() {
  return "value";
}`,
    "src/routes/@middleware.ts": `import { readSecret } from "../lib/session";
export const middleware = async ({ next }) => {
  const secret = readSecret();
  return secret ? await next() : await next();
};`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });`,
  });

  await expect(buildApplication(root)).resolves.toBeDefined();
});
