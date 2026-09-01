import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  unstable_verifyRoutePolicies,
  unstable_formatStaticPolicyFindings,
  unstable_verifyRoutePolicySource,
} from "@demiurgejs/core/vite";

describe("Vite static policy verification", () => {
  it("reports invalid literal CORS without evaluating the route module", async () => {
    const source = `
import { json } from "@demiurgejs/core";
throw new Error("the build evaluated this module");
export const GET = json({ ok: true }, {
  cors: { credentials: true, origins: "*" },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "cors-invalid",
        exportName: "GET",
        file: "/app/src/routes/api.ts",
        message:
          "Demiurge CORS policy cannot use wildcard origins with credentials.",
      }),
    ]);
  });

  it("supports aliased helpers, constants, as const, and satisfies", async () => {
    const source = `
import { json as sendJson, type CorsPolicy } from "@demiurgejs/core";
const cors = {
  methods: ["GET", "HEAD"],
  origins: ["https://example.com:8443"],
} as const satisfies CorsPolicy;
export const GET = sendJson({ ok: true }, { cors });`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("reports CORS methods that the route does not export", async () => {
    const source = `
import { text } from "@demiurgejs/core";
export const GET = text("ok", {
  cors: { methods: ["POST"], origins: "*" },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "cors-method-unavailable",
        exportName: "GET",
        message: "CORS method POST is not available from this route.",
      }),
    ]);
  });

  it("accepts HEAD when the route exports GET", async () => {
    const source = `
import { text } from "@demiurgejs/core";
export const GET = text("ok", {
  cors: { methods: ["HEAD"], origins: "*" },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("treats a named HTTP re-export as declared but unverified", async () => {
    const source = `
import { text } from "@demiurgejs/core";
export { POST } from "./post";
export const GET = text("ok", {
  cors: { methods: ["POST"], origins: "*" },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("reports invalid literal rate limit policy", async () => {
    const source = `
import { mutation } from "@demiurgejs/core";
export const POST = mutation({
  handler: () => new Response(),
  security: { rateLimit: { key: "ip", limit: 0, window: "1m" } },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/mutation.ts"),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "rate-limit-invalid",
        exportName: "POST",
      }),
    ]);
  });

  it("extracts attached CSP presets and validates their options", async () => {
    const source = `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  document: security.strict({
    trustedTypes: { mode: "report-only", policies: [] },
  }),
});`;

    const findings = await unstable_verifyRoutePolicySource(
      source,
      "/app/src/routes/@policy.ts",
    );

    expect(findings).toEqual([]);
  });

  it("does not guess environment-derived or function-built policy", async () => {
    const source = `
import { json } from "@demiurgejs/core";
const cors = createCors(process.env.API_ORIGIN);
export const GET = json({ ok: true }, { cors });`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("does not guess object spreads or computed properties", async () => {
    const source = `
import { json } from "@demiurgejs/core";
const base = { origins: "*" };
export const GET = json({ ok: true }, {
  cors: { ...base, ["credentials"]: true },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("does not reject an exported method with an unverified capability", async () => {
    const source = `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { methods: ["POST"], origins: "*" },
});
export const POST = createPostCapability();`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("does not reject a literal that a later spread can replace", async () => {
    const source = `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { credentials: true, origins: "*" },
  ...createDynamicOptions(),
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("reads route files and formats stable build diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-policy-files-"));
    const routesDir = join(root, "routes");
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(routesDir, { recursive: true })
    );
    await writeFile(join(routesDir, "api.ts"), `
import { json } from "@demiurgejs/core";
export const GET = json({}, {
  cors: { credentials: true, methods: ["POST"], origins: "*" },
});`);

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(findings).toHaveLength(2);
    expect(unstable_formatStaticPolicyFindings(findings)).toContain(
      "[cors-invalid]",
    );
  });

  it("returns no findings when the routes directory does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-policy-empty-"));

    await expect(unstable_verifyRoutePolicies(root)).resolves.toEqual([]);
  });

  it("formats findings without an HTTP export", () => {
    expect(unstable_formatStaticPolicyFindings([{
      code: "security-header-render-failed",
      file: "/app/src/routes/@policy.ts",
      message: "The document policy is invalid.",
      severity: "error",
    }])).toContain(
      "/app/src/routes/@policy.ts: [security-header-render-failed]",
    );
  });

  it.each([
    "html",
    "json",
    "jsonl",
    "notFound",
    "redirect",
    "response",
    "sse",
    "stream",
    "text",
  ])("accepts the %s helper without policy options", async (helper) => {
    const value = helper === "notFound" ? "" : "undefined";
    const source = `
import { ${helper} } from "@demiurgejs/core";
export const GET = ${helper}(${value});`;

    await expect(
      unstable_verifyRoutePolicySource(source, `/app/${helper}.ts`),
    ).resolves.toEqual([]);
  });

  it("extracts direct policy objects and static preset variants", async () => {
    const literal = `
export const policy = {
  security: { rateLimit: { key: "ip", limit: 0, window: +60 } },
  document: { csp: { scriptSrc: [\`https:\`] } },
};`;
    const preset = `
import { security } from "@demiurgejs/core";
export const policy = {
  document: security.static({ headers: { referrerPolicy: "invalid" } }),
};`;

    await expect(
      unstable_verifyRoutePolicySource(literal, "/app/@policy.ts"),
    ).resolves.toEqual([
      expect.objectContaining({ code: "rate-limit-invalid" }),
    ]);
    await expect(
      unstable_verifyRoutePolicySource(preset, "/app/@policy.ts"),
    ).resolves.toEqual([]);
  });

  it("accepts a reportTo name an ancestor policy file defines", async () => {
    const source = `
import { defineRoutePolicy } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  document: { csp: { defaultSrc: ["'self'"], reportTo: "default" } },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/admin/@policy.ts"),
    ).resolves.toEqual([]);
  });

  it("accepts a CORS OPTIONS method the framework answers itself", async () => {
    const source = `
import { json } from "@demiurgejs/core";
export const GET = json({ ok: true }, {
  cors: { methods: ["GET", "OPTIONS"], origins: ["https://example.com"] },
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/src/routes/api.ts"),
    ).resolves.toEqual([]);
  });

  it("validates a security preset inside defineRoutePolicy", async () => {
    const source = `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  document: security.strict({
    csp: { reportTo: "missing" },
    headers: { reportingEndpoints: { reports: "/reports" } },
  }),
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/@policy.ts"),
    ).resolves.toEqual([
      expect.objectContaining({ code: "security-header-render-failed" }),
    ]);
  });

  it.each(["api", "crossOriginIsolated", "strict"])(
    "extracts the %s security preset",
    async (preset) => {
      const source = `
import { security } from "@demiurgejs/core";
export const policy = { document: security.${preset}() };`;

      await expect(
        unstable_verifyRoutePolicySource(source, "/app/@policy.ts"),
      ).resolves.toEqual([]);
    },
  );

  it("does not guess a security preset's runtime-derived options", async () => {
    const source = `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  document: security.strict(buildOptions()),
});`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/@policy.ts"),
    ).resolves.toEqual([]);
  });

  it("ignores unrelated exports and unsupported helper calls", async () => {
    const source = `
import { json } from "another-package";
const local = () => ({ credentials: true, origins: "*" });
export const value = 1;
export const GET = local();
export { json as helper };
export const POST = () => null;`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/mixed.tsx"),
    ).resolves.toEqual([]);
  });

  it("extracts identifier options and negative numeric literals", async () => {
    const options = {
      cors: {
        maxAge: -1,
        origins: ["https://example.com"],
      },
    };
    const source = `
import { json } from "@demiurgejs/core";
const options = ${JSON.stringify(options).replace("-1", "-1")};
export const GET = json({}, options);`;

    await expect(
      unstable_verifyRoutePolicySource(source, "/app/api.ts"),
    ).resolves.toEqual([
      expect.objectContaining({ code: "cors-invalid" }),
    ]);
  });
});
