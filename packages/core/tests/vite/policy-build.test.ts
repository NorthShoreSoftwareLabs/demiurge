import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { demiurge } from "@demiurgejs/core/vite";

async function buildPolicyRoute(source: string) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-policy-build-"));
  const routesDir = join(root, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    join(routesDir, "@not-found.tsx"),
    "export default function NotFound() { return null; }",
  );
  await writeFile(join(routesDir, "api.ts"), source);

  return await build({
    logLevel: "silent",
    plugins: [demiurge({ styles: false })],
    root,
  });
}

describe("Vite production policy build", () => {
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
import { action } from "@demiurgejs/core";
export const POST = action({
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
