import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, expect, test } from "vitest";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";
import { defineEnvSchema, env } from "@demiurgejs/core";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

const schema = defineEnvSchema({
  PUBLIC_API_URL: env.url({ client: true }),
  READ_LIMIT: env.integer({ optional: true }),
  SESSION_SECRET: env.secret({ optional: true }),
});

async function createApplication(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-env-build-"));
  roots.push(root);
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

  for (const [file, source] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source);
  }

  return root;
}

function buildApplication(root: string) {
  return build({
    build: {
      outDir: join(root, "dist"),
      rollupOptions: { external: ["@demiurgejs/core"] },
    },
    configFile: false,
    logLevel: "silent",
    plugins: [demiurge({ env: schema, styles: false })],
    root,
  });
}

async function readBundle(root: string) {
  const assetsDir = join(root, "dist", "assets");
  const files = await readdir(assetsDir);
  const sources = await Promise.all(
    files.map((file) => readFile(join(assetsDir, file), "utf8")),
  );

  return sources.join("\n");
}

test("the build refuses a route that reads a secret variable", async () => {
  const root = await createApplication({
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
const secret = process.env.SESSION_SECRET;
export const GET = page({ view: () => secret });`,
  });

  await expect(buildApplication(root)).rejects.toThrow(/SESSION_SECRET/);
  await expect(buildApplication(root)).rejects.toThrow(
    /A secret variable never reaches the browser/,
  );
});

test("the build gives the import path of a transitive read", async () => {
  const root = await createApplication({
    "src/lib/session.ts": `import { readEnv } from "@demiurgejs/core";
import { schema } from "./schema";
export function readSecret() {
  const { SESSION_SECRET } = readEnv(schema);
  return SESSION_SECRET;
}`,
    "src/lib/schema.ts": "export const schema = {};",
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
import { readSecret } from "../lib/session";
export const GET = page({ view: () => readSecret() });`,
  });

  const failure = await buildApplication(root).catch((error: unknown) => error);
  const message = failure instanceof Error ? failure.message : String(failure);

  expect(message).toContain("variable: SESSION_SECRET");
  expect(message).toContain(join("src", "lib", "session.ts"));
  expect(message).toContain(join("src", "routes", "index.tsx"));
  expect(message).toContain("client-entry");
});

test("the build refuses a read of a variable that stays on the server", async () => {
  const root = await createApplication({
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
const limit = process.env.READ_LIMIT;
export const GET = page({ view: () => limit });`,
  });

  await expect(buildApplication(root)).rejects.toThrow(
    /Declare the variable with client: true/,
  );
});

test("the build accepts a secret that only a server-only module reads", async () => {
  const root = await createApplication({
    "src/routes/@middleware.ts": `export const middleware = async ({ next }) => {
  const secret = process.env.SESSION_SECRET;
  return secret ? await next() : await next();
};`,
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });`,
  });

  await expect(buildApplication(root)).resolves.toBeDefined();
});

test("the build puts the value of a client variable in the browser bundle", async () => {
  const root = await createApplication({
    "src/routes/index.tsx": `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });`,
  });
  process.env.PUBLIC_API_URL = "https://api.example.test/v1";
  process.env.SESSION_SECRET = "a-secret-value-of-the-server";

  try {
    await buildApplication(root);
    const bundle = await readBundle(root);

    expect(bundle).toContain("https://api.example.test/v1");
    expect(bundle).toContain("PUBLIC_API_URL");
    expect(bundle).not.toContain("a-secret-value-of-the-server");
    expect(bundle).not.toContain("SESSION_SECRET");
  } finally {
    delete process.env.PUBLIC_API_URL;
    delete process.env.SESSION_SECRET;
  }
});
