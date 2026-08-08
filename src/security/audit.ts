import type { HttpMethod } from "../route/types";
import { createSecurityHeaders } from "./policy";
import { validateCorsPolicy } from "./cors";
import type {
  CorsPolicy,
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
  const headers = options.document
    ? auditDocumentPolicy(options.document.policy, options.document.headers, findings)
    : {};
  const route = options.route
    ? auditRoutePolicy(options.route, findings)
    : undefined;

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
