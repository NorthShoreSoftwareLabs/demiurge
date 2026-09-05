import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger } from "vite";
import { describe, expect, it } from "vitest";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";

async function buildPolicyRoute(source: string) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-policy-build-"));
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    `export default function NotFound() { return null; }
export const policy = { document: { csp: false } };`,
  );
  await writeFile(join(routesDir, "api.ts"), source);

  return await build({
    logLevel: "silent",
    plugins: [demiurge({ styles: false })],
    root,
  });
}

async function buildPagePolicyRoute(policy: string) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-page-policy-build-"));
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  // The fallback document declares its own exception so the assertions below
  // stay focused on the page route under test.
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    `export default function NotFound() { return null; }
export const policy = { document: { csp: false } };`,
  );
  await writeFile(
    join(routesDir, "index.tsx"),
    `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });
${policy}`,
  );

  return { root, routesDir };
}

async function runPagePolicyBuild(root: string) {
  const warnings: string[] = [];
  const logger = createLogger("silent");
  logger.warn = (message) => warnings.push(message);

  try {
    await build({
      build: {
        outDir: join(root, "dist"),
        rollupOptions: { external: ["@demiurgejs/core"] },
      },
      configFile: false,
      customLogger: logger,
      logLevel: "silent",
      plugins: [demiurge({ styles: false })],
      root,
    });
    return warnings;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("Vite production policy build", () => {
  it("fails the build and names the route, the source, and the repair when a page policy has no CSP", async () => {
    const { root, routesDir } = await buildPagePolicyRoute(`export const policy = {
  document: { headers: { contentTypeOptions: "nosniff" } },
};`);

    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    await expect(runPagePolicyBuild(root)).rejects.toThrow(
      new RegExp(
        `${escape(join(routesDir, "index.tsx"))}.*\\[document-policy-missing\\].*No @policy\\.ts file exists.*Create ${escape(join(routesDir, "@policy.ts"))}`,
        "s",
      ),
    );
  });

  it("completes without a document-policy-missing failure when a page policy disables CSP", async () => {
    const { root } = await buildPagePolicyRoute(
      "export const policy = { document: { csp: false } };",
    );
    const warnings = await runPagePolicyBuild(root);

    expect(warnings).not.toContainEqual(
      expect.stringContaining("[document-policy-missing]"),
    );
  });

  it("fails the build when the not-found fallback document inherits no document policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-fallback-policy-build-"));
    const routesDir = join(root, "src", "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, "@not-found.tsx"),
      "export default function NotFound() { return null; }",
    );
    await writeFile(
      join(routesDir, "index.tsx"),
      `import { page } from "@demiurgejs/core";
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const GET = page({ view: () => null });
export const policy = defineRoutePolicy({ document: security.strict() });`,
    );

    await expect(runPagePolicyBuild(root)).rejects.toThrow(
      /@not-found\.tsx.*\[document-policy-missing\]/s,
    );
  });

  it.each([
    {
      code: "cors-invalid",
      source: `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { credentials: true, origins: "*" },
});`,
    },
    {
      code: "cors-invalid",
      source: `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { origins: ["https://example.com/"] },
});`,
    },
    {
      code: "cors-method-unavailable",
      source: `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { methods: ["POST"], origins: "*" },
});`,
    },
    {
      code: "rate-limit-invalid",
      source: `
import { mutation } from "@demiurgejs/core";
export const POST = mutation({
  handler: () => new Response(),
  security: { rateLimit: { key: "ip", limit: 0, window: "1m" } },
});`,
    },
    {
      code: "security-header-render-failed",
      source: `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  document: security.strict({
    csp: { reportTo: "missing" },
    headers: { reportingEndpoints: { reports: "/reports" } },
  }),
});`,
    },
  ])("fails a real production build for $code", async ({ code, source }) => {
    await expect(buildPolicyRoute(source)).rejects.toThrow(
      new RegExp(`api\\.ts.*\\[${code}\\]`),
    );
  });
});
