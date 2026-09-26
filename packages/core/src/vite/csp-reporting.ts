import { createSecurityReportHandler } from "../security/report";
import type { BodySizeValue } from "../security/types";
import { isObjectLike } from "../type-guards";

export const CSP_REPORT_PATH = "/_demiurge/csp-report";

const defaultMaxBodySize = "16kb" satisfies BodySizeValue;
const defaultDeduplicationCapacity = 256;
const defaultDeduplicationTtlMs = 60_000;
const defaultRateLimitMax = 10;
const defaultRateLimitWindowMs = 10_000;
const maximumFieldLength = 512;

export type DevCspReportCollectorOptions = {
  deduplicationCapacity?: number;
  deduplicationTtlMs?: number;
  log: (message: string) => void;
  maxBodySize?: BodySizeValue;
  now?: () => number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
};

type SanitizedCspReport = {
  blocked: string;
  column?: number;
  directive: string;
  disposition?: "enforce" | "report";
  document: string;
  line?: number;
  source?: string;
};

class InvalidCspReportError extends Error {}

export function createDevCspReportCollector(
  options: DevCspReportCollectorOptions,
) {
  const now = options.now ?? Date.now;
  const capacity = requirePositiveInteger(
    options.deduplicationCapacity ?? defaultDeduplicationCapacity,
    "deduplicationCapacity",
  );
  const ttl = requirePositiveInteger(
    options.deduplicationTtlMs ?? defaultDeduplicationTtlMs,
    "deduplicationTtlMs",
  );
  const rateLimitMax = requirePositiveInteger(
    options.rateLimitMax ?? defaultRateLimitMax,
    "rateLimitMax",
  );
  const rateLimitWindow = requirePositiveInteger(
    options.rateLimitWindowMs ?? defaultRateLimitWindowMs,
    "rateLimitWindowMs",
  );
  const recentReports = new Map<string, number>();
  let rateWindowStarted = now();
  let logsInWindow = 0;

  function logReport(sanitized: SanitizedCspReport) {
    const timestamp = now();

    removeExpiredReports(recentReports, timestamp);

    const key = JSON.stringify(sanitized);
    const existingExpiry = recentReports.get(key);

    if (existingExpiry !== undefined && existingExpiry > timestamp) return;

    if (timestamp - rateWindowStarted >= rateLimitWindow) {
      rateWindowStarted = timestamp;
      logsInWindow = 0;
    }

    if (logsInWindow >= rateLimitMax) return;

    if (recentReports.size >= capacity) {
      const oldest = recentReports.keys().next();

      if (!oldest.done) recentReports.delete(oldest.value);
    }

    recentReports.set(key, timestamp + ttl);
    logsInWindow += 1;
    options.log(formatCspReport(sanitized));
  }

  const maxBodySize = options.maxBodySize ?? defaultMaxBodySize;

  return {
    async handle(request: Request): Promise<Response | null> {
      if (new URL(request.url).pathname !== CSP_REPORT_PATH) return null;

      const reports: SanitizedCspReport[] = [];
      const handler = createSecurityReportHandler({
        maxBodySize,
        onReport(report) {
          const sanitized = sanitizeCspReport(report);

          if (sanitized) reports.push(sanitized);
        },
      });

      try {
        const response = await handler(request);

        if (response.status === 204) reports.forEach(logReport);
        return response;
      } catch (error) {
        if (error instanceof InvalidCspReportError) {
          return new Response("Invalid CSP report.", { status: 400 });
        }

        throw error;
      }
    },
  };
}

function sanitizeCspReport(value: unknown): SanitizedCspReport | undefined {
  if (!isObjectLike(value)) throw new InvalidCspReportError();

  let report: Record<string, unknown> = value;

  if ("type" in value || "body" in value) {
    if (value.type !== "csp-violation" || !isObjectLike(value.body)) {
      return undefined;
    }

    report = normalizeReportingApiReport(value.body);
  }

  const directive = safeDirective(
    report["effective-directive"] ?? report["violated-directive"],
  );
  const blocked = safeBlockedOrigin(report["blocked-uri"]);
  const document = safePath(report["document-uri"]);
  const disposition = safeDisposition(report.disposition);
  const source = optionalPath(report["source-file"]);
  const line = optionalLocation(report["line-number"]);
  const column = optionalLocation(report["column-number"]);

  return {
    blocked,
    column,
    directive,
    disposition,
    document,
    line,
    source,
  };
}

function safeDirective(value: unknown) {
  const sanitized = requiredText(value).toLowerCase();

  if (!/^[a-z][a-z0-9-]*$/.test(sanitized)) {
    throw new InvalidCspReportError();
  }

  return sanitized;
}

function safeBlockedOrigin(value: unknown) {
  const sanitized = requiredText(value);

  if (/^[a-z][a-z0-9+.-]*:?$/i.test(sanitized)) {
    return sanitized.replace(/:$/, "").toLowerCase();
  }

  try {
    const url = new URL(sanitized);

    return url.origin === "null" ? "opaque" : truncate(url.origin);
  } catch {
    if ([
      "eval",
      "inline",
      "self",
      "trusted-types-policy",
      "trusted-types-sink",
      "wasm-eval",
    ].includes(sanitized.toLowerCase())) {
      return sanitized.toLowerCase();
    }

    throw new InvalidCspReportError();
  }
}

function safePath(value: unknown) {
  const sanitized = requiredText(value);

  try {
    return truncate(new URL(sanitized).pathname || "/");
  } catch {
    throw new InvalidCspReportError();
  }
}

function optionalPath(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;

  try {
    return safePath(value);
  } catch {
    return undefined;
  }
}

function normalizeReportingApiReport(value: Record<string, unknown>) {
  return {
    "blocked-uri": value.blockedURL,
    "column-number": value.columnNumber,
    disposition: value.disposition,
    "document-uri": value.documentURL,
    "effective-directive": value.effectiveDirective,
    "line-number": value.lineNumber,
    "source-file": value.sourceFile,
    "violated-directive": value.violatedDirective,
  };
}

function safeDisposition(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;

  const sanitized = requiredText(value).toLowerCase();

  if (sanitized !== "enforce" && sanitized !== "report") {
    throw new InvalidCspReportError();
  }

  return sanitized;
}

function optionalLocation(value: unknown) {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidCspReportError();
  }

  return value;
}

function requiredText(value: unknown) {
  if (typeof value !== "string") throw new InvalidCspReportError();

  const sanitized = truncate(removeControlCharacters(value).trim());

  if (!sanitized) throw new InvalidCspReportError();

  return sanitized;
}

function removeControlCharacters(value: string) {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && (code < 127 || code > 159);
  }).join("");
}

function truncate(value: string) {
  return value.slice(0, maximumFieldLength);
}

function formatCspReport(report: SanitizedCspReport) {
  const location = report.source
    ? `${report.source}${report.line === undefined ? "" : `:${report.line}`}${report.column === undefined ? "" : `:${report.column}`}`
    : undefined;

  return [
    "Demiurge received a CSP report:",
    `directive=${report.directive}`,
    `blocked=${report.blocked}`,
    `document=${report.document}`,
    location ? `source=${location}` : undefined,
    report.disposition ? `disposition=${report.disposition}` : undefined,
  ].filter(Boolean).join(" ");
}

function removeExpiredReports(reports: Map<string, number>, timestamp: number) {
  for (const [key, expiry] of reports) {
    if (expiry <= timestamp) reports.delete(key);
  }
}

function requirePositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`CSP report ${name} must be a positive integer.`);
  }

  return value;
}
