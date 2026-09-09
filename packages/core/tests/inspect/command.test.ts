import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedDemiurgeConfig } from "../../src/config/types";
import {
  countErrorFindings,
  createStaticPolicyReport,
  findSecretEnvKeys,
  formatStaticPolicyReportSummary,
  INSPECT_EXIT_FINDINGS,
  INSPECT_EXIT_INVALID,
  INSPECT_EXIT_OK,
  runInspectCommand,
  STATIC_POLICY_REPORT_VERSION,
  type StaticPolicyReport,
} from "../../src/inspect";
import { env } from "../../src/security";

const publicAccessPolicy = "export const policy = { access: { public: true } };";
const documentPolicy = `export const policy = {
  access: { public: true },
  document: { csp: { "default-src": ["'self'"] } },
};`;
const pageRoute = `
import { page } from "@demiurgejs/core";
export const GET = page(() => null);`;
const notFoundRoute = "export default function NotFound() { return null; }";
const resourceRoute = `
import { json } from "@demiurgejs/core";
export const GET = json({ ok: true });`;

async function createApplication(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "demiurge-inspect-"));

  for (const [name, source] of Object.entries(files)) {
    const file = join(root, "src", "routes", name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }

  return root;
}

function createConfig(root: string): ResolvedDemiurgeConfig {
  return { configFile: join(root, "demiurge.config.ts"), root };
}

describe("the static inspection report", () => {
  it("describes each route file without loading a route module", async () => {
    const root = await createApplication({
      "@policy.ts": documentPolicy,
      "@not-found.tsx": notFoundRoute,
      "index.tsx": `throw new Error("the report evaluated this module");${pageRoute}`,
      "api/items/[id].ts": resourceRoute,
    });

    const report = await createStaticPolicyReport({ root });

    expect(report.version).toBe(STATIC_POLICY_REPORT_VERSION);
    expect(report.routesDir).toBe("src/routes");
    expect(report.resolutions).toEqual({
      findings: "static",
      redactions: "static",
      request: "request",
      routes: "static",
    });
    expect(report.routes).toEqual([
      expect.objectContaining({ file: "@not-found.tsx", kind: "attached" }),
      expect.objectContaining({ file: "@policy.ts", kind: "attached" }),
      expect.objectContaining({
        file: "api/items/[id].ts",
        kind: "resource",
        methods: ["GET"],
        pattern: "/api/items/[id]",
      }),
      expect.objectContaining({
        declaredAccess: "absent",
        declaredDocumentCsp: "absent",
        declaresDocumentPolicy: false,
        file: "index.tsx",
        kind: "page",
        methods: ["GET"],
        pattern: "/",
      }),
    ]);
    expect(report.routes[0]).not.toHaveProperty("pattern");
  });

  it("returns an empty report when the route directory is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-inspect-empty-"));
    const report = await createStaticPolicyReport({ root });

    expect(report.routes).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.request.length).toBeGreaterThan(0);
  });

  it("reads the route directory of the plugin options", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-inspect-custom-"));
    const file = join(root, "app", "routes", "@policy.ts");

    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, publicAccessPolicy);

    const report = await createStaticPolicyReport({
      options: { routesDir: "app/routes" },
      root,
    });

    expect(report.routesDir).toBe("app/routes");
    expect(report.routes).toHaveLength(1);
  });

  it("writes a summary that names each finding", async () => {
    const root = await createApplication({
      "@policy.ts": publicAccessPolicy,
      "@not-found.tsx": notFoundRoute,
      "index.tsx": pageRoute,
    });
    const report = await createStaticPolicyReport({ root });

    expect(countErrorFindings(report)).toBeGreaterThan(0);
    const summary = formatStaticPolicyReportSummary(report);
    expect(summary).toContain("Demiurge inspected 3 route files in src/routes.");
    expect(summary).toContain("document-policy-missing");
  });

  it("reads the names that an environment secret declaration produced", () => {
    expect(
      findSecretEnvKeys({
        PUBLIC_URL: env.url(),
        SESSION_SECRET: env.secret(),
      }),
    ).toEqual(["SESSION_SECRET"]);
    expect(findSecretEnvKeys(undefined)).toEqual([]);
  });
});

describe("the demiurge inspect command", () => {
  it("exits with 0 and writes JSON when no finding has error severity", async () => {
    const root = await createApplication({
      "@policy.ts": documentPolicy,
      "@not-found.tsx": notFoundRoute,
      "index.tsx": pageRoute,
    });

    const result = await runInspectCommand({
      arguments: [],
      loadConfig: async () => createConfig(root),
    });

    expect(result.exitCode).toBe(INSPECT_EXIT_OK);
    const report = JSON.parse(result.stdout) as StaticPolicyReport;
    expect(report.version).toBe(STATIC_POLICY_REPORT_VERSION);
    expect(report.findings).toEqual([]);
    expect(report.redactions).toEqual([]);
    expect(result.stderr).toContain("Findings: 0 error, 0 warning.");
  });

  it("exits with 1 when the report holds a finding with error severity", async () => {
    const root = await createApplication({
      "@policy.ts": publicAccessPolicy,
      "@not-found.tsx": notFoundRoute,
      "index.tsx": pageRoute,
    });

    const result = await runInspectCommand({
      arguments: [],
      loadConfig: async () => createConfig(root),
    });

    expect(result.exitCode).toBe(INSPECT_EXIT_FINDINGS);
    const report = JSON.parse(result.stdout) as StaticPolicyReport;
    expect(report.findings.some((finding) => finding.severity === "error")).toBe(
      true,
    );
  });

  it("gives the same report for the same route tree", async () => {
    const root = await createApplication({
      "@policy.ts": documentPolicy,
      "@not-found.tsx": notFoundRoute,
      "index.tsx": pageRoute,
    });
    const load = async () => createConfig(root);
    const first = await runInspectCommand({ arguments: [], loadConfig: load });
    const second = await runInspectCommand({ arguments: [], loadConfig: load });

    expect(first.stdout).toBe(second.stdout);
    expect(first.exitCode).toBe(second.exitCode);
  });

  it("exits with 2 for an argument that the command does not accept", async () => {
    const result = await runInspectCommand({
      arguments: ["--verbose"],
      loadConfig: async () => {
        throw new Error("the command loaded the configuration");
      },
    });

    expect(result.exitCode).toBe(INSPECT_EXIT_INVALID);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "invalid-argument",
      detail: "The command received --verbose.",
      title: "The inspect command accepts no argument.",
      version: 1,
    });
  });

  it("exits with 2 when the framework cannot read the configuration", async () => {
    const result = await runInspectCommand({
      arguments: [],
      loadConfig: async () => {
        throw new Error("demiurge.config.ts is absent.");
      },
    });

    expect(result.exitCode).toBe(INSPECT_EXIT_INVALID);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "configuration-unreadable",
      detail: "demiurge.config.ts is absent.",
      title: "Demiurge could not read the configuration.",
      version: 1,
    });
    expect(result.stderr).toContain("Demiurge could not read the configuration.");
  });

  it("states a thrown value that is not an error", async () => {
    const result = await runInspectCommand({
      arguments: [],
      loadConfig: async () => {
        throw "the loader refused";
      },
    });

    expect(result.exitCode).toBe(INSPECT_EXIT_INVALID);
    expect(result.stderr).toContain("the loader refused");
  });
});
