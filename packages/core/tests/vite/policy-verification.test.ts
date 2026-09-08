import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  unstable_verifyRoutePolicies,
  unstable_formatStaticPolicyFindings,
  unstable_verifyRoutePolicySource,
} from "@demiurgejs/core/vite";

const pageRouteSource = `
import { page } from "@demiurgejs/core";
export const GET = page(() => null);`;

// The build denies a route that inherits no access declaration. A fixture
// that does not examine access gets a public declaration at the root.
const publicAccessPolicy = "export const policy = { access: { public: true } };";

async function createRouteTree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-policy-tree-"));
  const tree = "@policy.ts" in files
    ? files
    : { "@policy.ts": publicAccessPolicy, ...files };

  for (const [name, source] of Object.entries(tree)) {
    const file = join(root, "routes", name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }

  return root;
}

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
    await writeFile(join(routesDir, "@policy.ts"), publicAccessPolicy);
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

  it("reports a page route that inherits no document policy", async () => {
    const root = await createRouteTree({
      "index.tsx": pageRouteSource,
      "@policy.ts": `
import { defineRoutePolicy } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  access: { public: true },
  security: { request: { allowedMethods: ["GET"] } },
});`,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "document-policy-missing",
        file: join(root, "routes", "index.tsx"),
        severity: "warning",
      }),
    ]);
  });

  it("accepts a page route that inherits a document policy from a parent", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  access: { public: true },
  document: security.strict(),
});`,
      "blog/index.tsx": pageRouteSource,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("warns when a route-local document policy has headers but no CSP", async () => {
    const root = await createRouteTree({
      "index.tsx": `${pageRouteSource}
export const policy = { document: { headers: { contentTypeOptions: "nosniff" } } };`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "document-policy-missing",
        file: join(root, "routes", "index.tsx"),
      }),
    ]);
  });

  it("accepts an inherited policy that explicitly disables CSP", async () => {
    const root = await createRouteTree({
      "@policy.ts":
        `export const policy = { access: { public: true }, document: { csp: false } };`,
      "index.tsx": pageRouteSource,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("keeps an inherited CSP when a child policy adds only headers", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { security } from "@demiurgejs/core";
export const policy = { access: { public: true }, document: security.strict() };`,
      "admin/@policy.ts": `
export const policy = { document: { headers: { contentTypeOptions: "nosniff" } } };`,
      "admin/index.tsx": pageRouteSource,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("allows an unknown policy expression without a missing-CSP warning", async () => {
    const root = await createRouteTree({
      "@policy.ts": `export const policy = createPolicy();`,
      "index.tsx": pageRouteSource,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("allows an unknown route-local policy without a missing-CSP warning", async () => {
    const root = await createRouteTree({
      "index.tsx": `${pageRouteSource}
export const policy = { document: createDocumentPolicy() };`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it.each([
    {
      name: "a constant policy with an explicit opt-out",
      source: `
const documentPolicy = { csp: false };
const routePolicy = { document: documentPolicy };
export const policy = routePolicy;`,
    },
    {
      name: "a constant policy with a CSP object",
      source: `
const documentPolicy = { csp: { defaultSrc: ["'self'"] } };
const routePolicy = { document: documentPolicy };
export const policy = routePolicy;`,
    },
  ])("reads $name", async ({ source }) => {
    const root = await createRouteTree({
      "index.tsx": `${pageRouteSource}
${source}`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("reads static preset options and accepts an unknown preset", async () => {
    const root = await createRouteTree({
      "index.tsx": `${pageRouteSource}
import { security } from "@demiurgejs/core";
const options = { csp: false };
export const policy = { document: security.strict(options) };`,
      "admin/index.tsx": `${pageRouteSource}
import { security } from "@demiurgejs/core";
export const policy = { document: security.custom() };`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("keeps unknown static expressions out of missing-CSP diagnostics", async () => {
    const root = await createRouteTree({
      "unknown-identifier.tsx": `${pageRouteSource}
const routePolicy = { document: documentPolicy };
export const policy = routePolicy;`,
      "undefined-document.tsx": `${pageRouteSource}
export const policy = { document: undefined };`,
      "unknown-member.tsx": `${pageRouteSource}
export const policy = { document: options.strict() };`,
      "unknown-csp.tsx": `${pageRouteSource}
export const policy = { document: { csp: dynamicCsp } };`,
      "spread-document.tsx": `${pageRouteSource}
export const policy = { document: { ...dynamicDocument } };`,
      "computed-document.tsx": `${pageRouteSource}
const key = "csp";
export const policy = { document: { [key]: false } };`,
      "dynamic-preset-options.tsx": `${pageRouteSource}
import { security } from "@demiurgejs/core";
export const policy = { document: security.strict(dynamicOptions) };`,
      "invalid-preset-options.tsx": `${pageRouteSource}
import { security } from "@demiurgejs/core";
export const policy = { document: security.strict(1) };`,
      "constant-csp-value.tsx": `${pageRouteSource}
const csp = "invalid";
export const policy = { document: { csp } };`,
      "constant-primitive-policy.tsx": `${pageRouteSource}
const routePolicy = 1;
export const policy = routePolicy;`,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(
      findings
        .filter((finding) => finding.code === "document-policy-missing")
        .map((finding) => finding.file),
    ).toEqual([
      join(root, "routes", "undefined-document.tsx"),
    ]);
  });

  it("accepts a page route that declares its own document policy", async () => {
    const root = await createRouteTree({
      "index.tsx": `${pageRouteSource}
export const policy = { document: { csp: false } };`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("reports no document policy for a route tree without a page route", async () => {
    const root = await createRouteTree({
      "api.ts": `
import { json } from "@demiurgejs/core";
export const GET = json({ ok: true });`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("does not report a policy expression that the build cannot read", async () => {
    const root = await createRouteTree({
      "index.tsx": pageRouteSource,
      "@policy.ts": `
import { defineRoutePolicy } from "@demiurgejs/core";
export const policy = defineRoutePolicy(createPolicy());`,
    });

    await expect(
      unstable_verifyRoutePolicies(root, { routesDir: "routes" }),
    ).resolves.toEqual([]);
  });

  it("reports a route that inherits no access declaration", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({ document: security.strict() });`,
      "index.tsx": pageRouteSource,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "access-declaration-missing",
        file: join(root, "routes", "index.tsx"),
        severity: "error",
      }),
    );
  });

  it("accepts a route that inherits an access declaration from a parent", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  access: { public: true },
  document: security.strict(),
});`,
      "blog/index.tsx": pageRouteSource,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(
      findings.filter((finding) =>
        finding.code === "access-declaration-missing"
      ),
    ).toEqual([]);
  });

  it("accepts a route that declares access with a hook", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { defineRoutePolicy, security } from "@demiurgejs/core";
export const policy = defineRoutePolicy({
  access: { authorize: ({ context }) => Boolean(context.principal) },
  document: security.strict(),
});`,
      "index.tsx": pageRouteSource,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(
      findings.filter((finding) =>
        finding.code === "access-declaration-missing"
      ),
    ).toEqual([]);
  });

  it("does not report an access expression that the build cannot read", async () => {
    const root = await createRouteTree({
      "@policy.ts": `
import { defineRoutePolicy } from "@demiurgejs/core";
export const policy = defineRoutePolicy(createPolicy());`,
      "index.tsx": pageRouteSource,
    });

    const findings = await unstable_verifyRoutePolicies(root, {
      routesDir: "routes",
    });

    expect(
      findings.filter((finding) =>
        finding.code === "access-declaration-missing"
      ),
    ).toEqual([]);
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
