import type { HttpMethod } from "../route/types";
import type { ScriptTag } from "../document/scripts";
import { createSecurityHeaders } from "./policy";
import { validateCorsPolicy } from "./cors";
import type {
  ContentSecurityPolicy,
  CorsPolicy,
  CspSource,
  RouteSecurityPolicy,
  SecurityAudit,
  SecurityAuditFinding,
  SecurityAuditOptions,
  SecurityHeadersOptions,
  SecurityPolicy,
} from "./types";

const unsafeMethods = new Set<HttpMethod>(["DELETE", "PATCH", "POST", "PUT"]);

export function createSecurityAudit(options: SecurityAuditOptions = {}) {
  const findings: SecurityAuditFinding[] = [];
  const document = options.document;
  const headers = document
    ? auditDocumentPolicy(document.policy, document.headers, findings)
    : {};
  const route = options.route
    ? auditRoutePolicy(options.route, findings)
    : undefined;

  if (document?.scripts) {
    auditDocumentScripts(
      document.policy.csp,
      document.scripts,
      document.headers,
      findings,
    );
  }

  return {
    findings,
    headers,
    route,
  } satisfies SecurityAudit;
}

function auditDocumentPolicy(
  policy: SecurityPolicy,
  options: SecurityHeadersOptions | undefined,
  findings: SecurityAuditFinding[],
) {
  try {
    return Object.fromEntries(createSecurityHeaders(policy, options));
  } catch (error) {
    findings.push({
      code: "security-header-render-failed",
      message: error instanceof Error ? error.message : "Security headers failed to render.",
      severity: "error",
    });

    return {};
  }
}

function auditDocumentScripts(
  policy: SecurityPolicy["csp"],
  scripts: readonly ScriptTag[],
  options: SecurityHeadersOptions | undefined,
  findings: SecurityAuditFinding[],
) {
  if (!policy) {
    return;
  }

  const scriptSrc = getScriptSources(policy);

  for (const script of scripts) {
    if (requiresScriptNonce(scriptSrc) && !script.nonce) {
      findings.push({
        code: "csp-script-missing-nonce",
        message: `Document script ${script.src} needs a nonce for the effective script-src policy.`,
        severity: "error",
      });
      continue;
    }

    if (script.nonce && options?.nonce && script.nonce === options.nonce) {
      continue;
    }

    if (!allowsScriptSource(scriptSrc, script.src)) {
      findings.push({
        code: "csp-script-src-blocked",
        message: `Document script ${script.src} is not allowed by the effective script-src policy.`,
        severity: "error",
      });
    }
  }
}

function getScriptSources(policy: ContentSecurityPolicy) {
  return policy.scriptSrc ?? policy.defaultSrc ?? [];
}

function requiresScriptNonce(sources: readonly CspSource[]) {
  return sources.some((source) => source.includes("'nonce-{nonce}'"));
}

function allowsScriptSource(sources: readonly CspSource[], src: string) {
  if (sources.includes("*")) {
    return true;
  }

  if (sources.includes("'none'")) {
    return false;
  }

  if (sources.some((source) => source.startsWith("'nonce-"))) {
    return false;
  }

  if (sources.includes("'self'") && isSameOriginPath(src)) {
    return true;
  }

  if (src.startsWith("https:") && sources.includes("https:")) {
    return true;
  }

  if (src.startsWith("http:") && sources.includes("http:")) {
    return true;
  }

  return sources.some((source) => sourceMatchesScriptSource(source, src));
}

function isSameOriginPath(src: string) {
  return src.startsWith("/") && !src.startsWith("//");
}

function sourceMatchesScriptSource(source: CspSource, src: string) {
  if (source.startsWith("'")) {
    return false;
  }

  try {
    const sourceUrl = new URL(source);
    const scriptUrl = new URL(src);

    return (
      scriptUrl.protocol === sourceUrl.protocol &&
      scriptUrl.hostname === sourceUrl.hostname &&
      scriptUrl.port === sourceUrl.port &&
      (sourceUrl.pathname === "/" || scriptUrl.pathname.startsWith(sourceUrl.pathname))
    );
  } catch {
    return false;
  }
}

function auditRoutePolicy(
  route: NonNullable<SecurityAuditOptions["route"]>,
  findings: SecurityAuditFinding[],
) {
  auditCorsPolicy(route.cors, findings);
  auditUnsafeMethodPolicy(route.method, route.security, findings);

  return {
    cors: route.cors,
    method: route.method,
    security: route.security,
  };
}

function auditCorsPolicy(
  policy: CorsPolicy | undefined,
  findings: SecurityAuditFinding[],
) {
  if (!policy) {
    return;
  }

  try {
    validateCorsPolicy(policy);
  } catch (error) {
    findings.push({
      code: "cors-invalid",
      message: error instanceof Error ? error.message : "CORS policy is invalid.",
      severity: "error",
    });
  }
}

function auditUnsafeMethodPolicy(
  method: HttpMethod,
  policy: RouteSecurityPolicy | undefined,
  findings: SecurityAuditFinding[],
) {
  if (!unsafeMethods.has(method)) {
    return;
  }

  if (!policy?.csrf) {
    findings.push({
      code: policy?.csrf === false ? "csrf-disabled" : "csrf-missing",
      message: policy?.csrf === false
        ? "CSRF protection is explicitly disabled for this unsafe route."
        : "Unsafe routes should declare CSRF protection or an explicit verified exemption.",
      severity: policy?.csrf === false ? "info" : "warning",
    });
  }

  if (!policy?.rateLimit) {
    findings.push({
      code: "rate-limit-missing",
      message: "Unsafe routes should declare rate limiting.",
      severity: "warning",
    });
  }

  if (!policy?.request?.maxBodySize) {
    findings.push({
      code: "request-body-limit-missing",
      message: "Unsafe routes should declare a request body size limit.",
      severity: "warning",
    });
  }
}
