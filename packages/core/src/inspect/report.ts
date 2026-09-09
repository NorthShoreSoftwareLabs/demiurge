import { relative, sep } from "node:path";
import { toRoutePattern, toRouteSegments } from "../router";
import type { EnvSchema } from "../security";
import {
  inspectRoutePolicies,
  type DemiurgeVitePluginOptions,
} from "../vite/plugin";
import type { RouteFileInspection } from "../vite/policy-verification";
import {
  STATIC_POLICY_REPORT_VERSION,
  type StaticPolicyReport,
  type StaticRouteReport,
} from "./types";

export type StaticPolicyReportOptions = {
  /** The plugin options of the application. */
  options?: DemiurgeVitePluginOptions;
  /** The absolute path of the project root. */
  root: string;
};

// A build knows the route tree and the policy cascade. It does not know a
// header, a cookie, a session, or an authorization result, because a request
// supplies each one. The report names these facts, so a reader learns which
// answer needs a running application.
const requestFacts = [
  "authorization-result",
  "cookie-values",
  "csrf-token",
  "environment-values",
  "rate-limit-state",
  "request-headers",
  "response-headers",
  "session-record",
];

/**
 * Builds the static inspection report of an application.
 *
 * The function reads the route tree and resolves the policy cascade through
 * `inspectRoutePolicies`. It loads no route module, so it runs no data loader
 * and no mutation handler.
 */
export async function createStaticPolicyReport(
  input: StaticPolicyReportOptions,
): Promise<StaticPolicyReport> {
  const options = input.options ?? {};
  const pass = await inspectRoutePolicies(input.root, options);
  const routes = pass.inspections
    .map((inspection) => toStaticRouteReport(pass.routesDir, inspection))
    .sort((left, right) => left.file.localeCompare(right.file));

  return {
    findings: pass.findings,
    redactions: [],
    request: requestFacts,
    resolutions: {
      findings: "static",
      redactions: "static",
      request: "request",
      routes: "static",
    },
    routes,
    routesDir: toPosixPath(relative(input.root, pass.routesDir)),
    version: STATIC_POLICY_REPORT_VERSION,
  };
}

/** Reads the names of the variables that `env.secret(...)` declared. */
export function findSecretEnvKeys(schema: EnvSchema | undefined) {
  return Object.entries(schema ?? {})
    .filter(([, variable]) => variable.sensitive)
    .map(([key]) => key)
    .sort();
}

/** Counts the findings that carry error severity. */
export function countErrorFindings(report: StaticPolicyReport) {
  return report.findings.filter((finding) => finding.severity === "error")
    .length;
}

/** Writes the human summary that the command sends to standard error. */
export function formatStaticPolicyReportSummary(report: StaticPolicyReport) {
  const errors = countErrorFindings(report);
  const warnings = report.findings.length - errors;

  return [
    `Demiurge inspected ${report.routes.length} route files in ${report.routesDir}.`,
    `Findings: ${errors} error, ${warnings} warning.`,
    `The report states ${report.request.length} facts that only a request supplies.`,
    ...report.findings.map((finding) =>
      `  ${finding.severity}: ${toPosixPath(finding.file)} [${finding.code}] ${finding.message}`
    ),
  ].join("\n");
}

function toStaticRouteReport(
  routesDir: string,
  inspection: RouteFileInspection,
): StaticRouteReport {
  const file = toPosixPath(relative(routesDir, inspection.file));
  const fileSegments = file.replace(/\.tsx?$/, "").split("/");
  const attached = fileSegments.at(-1)?.startsWith("@") ?? false;

  return {
    declaredAccess: inspection.accessState,
    declaredDocumentCsp: inspection.documentCspState,
    declaresDocumentPolicy: inspection.declaresDocumentPolicy,
    file,
    kind: attached
      ? "attached"
      : inspection.declaresPageRoute
      ? "page"
      : "resource",
    methods: inspection.methods,
    ...(attached
      ? {}
      : { pattern: toRoutePattern(toRouteSegments(fileSegments)) }),
  };
}

function toPosixPath(pathname: string) {
  return pathname.split(sep).join("/");
}
