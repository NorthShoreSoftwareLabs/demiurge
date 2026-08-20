import type {
  ContentSecurityPolicy,
  CspHashAlgorithm,
  CspDirectiveValue,
  ReportingEndpointUrl,
  RoutePolicy,
  RouteSecurityNeeds,
  RouteSecurityPolicy,
  SecurityHeadersOptions,
  SecurityHeaderPolicy,
  SecurityPolicy,
  SecurityPreset,
  StrictTransportSecurityPolicy,
  TrustedTypesPolicy,
} from "./types";

const nonceToken = "{nonce}";

export const cspNonce = `'nonce-${nonceToken}'` as const;

const strictCsp = {
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  defaultSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:", "blob:"],
  objectSrc: ["'none'"],
  scriptSrc: [cspNonce, "'strict-dynamic'"],
  styleSrc: ["'self'", cspNonce],
  upgradeInsecureRequests: true,
} satisfies ContentSecurityPolicy;

const staticCsp = {
  ...strictCsp,
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
} satisfies ContentSecurityPolicy;

const strictHeaders = {
  contentTypeOptions: "nosniff",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  permissionsPolicy: "camera=(), microphone=(), geolocation=(), payment=()",
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: {
    includeSubDomains: false,
    maxAge: 31536000,
    preload: false,
  },
} satisfies SecurityHeaderPolicy;

const apiHeaders = {
  contentTypeOptions: "nosniff",
  crossOriginResourcePolicy: "same-origin",
  referrerPolicy: "strict-origin-when-cross-origin",
} satisfies SecurityHeaderPolicy;

export const security = {
  api(options: SecurityPolicy = {}) {
    return mergeSecurityPolicy(
      {
        headers: apiHeaders,
      },
      options,
    );
  },
  preset(name: SecurityPreset, options: SecurityPolicy = {}) {
    if (name === "api") {
      return security.api(options);
    }

    if (name === "cross-origin-isolated") {
      return security.crossOriginIsolated(options);
    }

    if (name === "static") {
      return security.static(options);
    }

    return security.strict(options);
  },
  static(options: SecurityPolicy = {}) {
    return mergeSecurityPolicy(
      {
        csp: staticCsp,
        headers: strictHeaders,
      },
      options,
    );
  },
  strict(options: SecurityPolicy = {}) {
    return mergeSecurityPolicy(
      {
        csp: strictCsp,
        headers: strictHeaders,
      },
      options,
    );
  },
  crossOriginIsolated(options: SecurityPolicy = {}) {
    return mergeSecurityPolicy(
      security.strict({
        headers: {
          crossOriginEmbedderPolicy: "require-corp",
          crossOriginOpenerPolicy: "same-origin",
        },
      }),
      options,
    );
  },
};

export function defineSecurityPolicy(policy: SecurityPolicy) {
  return policy;
}

export function defineRoutePolicy(policy: RoutePolicy) {
  return policy;
}

export function mergeSecurityPolicies(
  ...policies: Array<SecurityPolicy | false | undefined>
) {
  return policies.reduce<SecurityPolicy>((merged, policy) => {
    if (!policy) {
      return merged;
    }

    return mergeSecurityPolicy(merged, policy);
  }, {});
}

export function mergeRoutePolicies(
  ...policies: Array<RoutePolicy | false | undefined>
) {
  const merged = policies.reduce<RoutePolicy>((result, policy) => {
    if (!policy) {
      return result;
    }

    return {
      document: mergeSecurityPolicies(result.document, policy.document),
      security: mergeRouteSecurityPolicies(result.security, policy.security),
    };
  }, {});

  return {
    ...merged,
    document: applyPolicyNeeds(merged.document, merged.security?.needs),
  };
}

export function mergeRouteSecurityPolicies(
  ...policies: Array<RouteSecurityPolicy | false | undefined>
) {
  return policies.reduce<RouteSecurityPolicy>((merged, policy) => {
    if (!policy) {
      return merged;
    }

    return {
      csrf: policy.csrf ?? merged.csrf,
      needs: mergeRouteNeeds(merged.needs, policy.needs),
      rateLimit: policy.rateLimit ?? merged.rateLimit,
      request: mergeObject(merged.request, policy.request),
    };
  }, {});
}

// Each need widens exactly one directive. The pairing lives here so a
// diagnostic can name both the declared need and the directive it targets.
const routeNeedDirectives = [
  { directive: "connectSrc", need: "connect" },
  { directive: "imgSrc", need: "img" },
  { directive: "scriptSrc", need: "script" },
] as const satisfies readonly {
  directive: keyof ContentSecurityPolicy;
  need: keyof RouteSecurityNeeds;
}[];

function mergeRouteNeeds(
  base: RouteSecurityPolicy["needs"],
  override: RouteSecurityPolicy["needs"],
) {
  const merged: { -readonly [Key in keyof RouteSecurityNeeds]: string[] } = {};

  for (const { need } of routeNeedDirectives) {
    const sources = [...new Set([
      ...(base?.[need] ?? []),
      ...(override?.[need] ?? []),
    ])];

    if (sources.length > 0) {
      merged[need] = sources;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function applyPolicyNeeds(
  document: SecurityPolicy | undefined,
  needs: RouteSecurityNeeds | undefined,
) {
  if (!document?.csp || !needs) {
    return document;
  }

  let csp = document.csp;

  for (const { directive, need } of routeNeedDirectives) {
    csp = applyPolicyNeed(csp, directive, need, needs[need]);
  }

  return csp === document.csp ? document : { ...document, csp };
}

function applyPolicyNeed(
  csp: ContentSecurityPolicy,
  directive: keyof ContentSecurityPolicy,
  need: keyof RouteSecurityNeeds,
  sources: readonly string[] | undefined,
) {
  if (!sources || sources.length === 0) {
    return csp;
  }

  // A removed directive makes default-src govern that resource type. A need
  // could then widen only default-src, which also grants the source to every
  // other fetch directive. The framework refuses that silent grant and asks
  // for an explicit directive instead.
  if (csp[directive] === false) {
    throw new Error(
      `A route policy declares security.needs.${need} and sets csp.${directive} to false. Set an explicit csp.${directive} that includes ${sources.join(", ")}.`,
    );
  }

  if (csp[directive] === undefined && csp.defaultSrc === undefined) {
    return csp;
  }

  const current = resolveCspDirectiveValue(
    (csp[directive] ?? csp.defaultSrc) as CspDirectiveValue | undefined,
  ) ?? [];

  if (!Array.isArray(current)) {
    return csp;
  }

  return {
    ...csp,
    [directive]: [...new Set([...current, ...sources])],
  };
}

export async function cspHash(
  source: string,
  algorithm: CspHashAlgorithm = "sha256",
) {
  const digest = await globalThis.crypto.subtle.digest(
    toWebCryptoAlgorithm(algorithm),
    new TextEncoder().encode(source),
  );

  return `'${algorithm}-${toBase64(new Uint8Array(digest))}'`;
}

export function createSecurityHeaders(
  policy: SecurityPolicy,
  options: SecurityHeadersOptions = {},
) {
  if (policy.csp) {
    validateCspDirectiveValues(policy.csp);
  }

  validateReportingConfiguration(policy);

  const headers = new Headers();
  const csp = policy.csp !== false && policy.csp
    ? renderCsp(policy.csp, options)
    : undefined;
  const trustedTypes = renderTrustedTypes(policy.trustedTypes);

  // Trusted Types is carried by CSP directives, so report-only means moving
  // those directives to the report-only header rather than enforcing them. The
  // report-only header deliberately carries nothing else: repeating the base
  // policy there would report every ordinary CSP violation a second time.
  const reportsTrustedTypes = policy.trustedTypes
    ? policy.trustedTypes.mode === "report-only"
    : false;

  setHeader(
    headers,
    "content-security-policy",
    joinCspDirectives(csp, reportsTrustedTypes ? undefined : trustedTypes),
  );
  setHeader(
    headers,
    "content-security-policy-report-only",
    reportsTrustedTypes
      ? joinCspDirectives(trustedTypes, renderCspReportingDirectives(policy.csp))
      : undefined,
  );

  applySecurityHeaders(headers, policy.headers, options);

  return headers;
}

export function securityPolicyRequiresNonce(
  policy: SecurityPolicy | false | undefined,
) {
  if (!policy || !policy.csp) {
    return false;
  }

  return cspDirectiveEntries(policy.csp).some(([, value]) => {
    const resolved = resolveCspDirectiveValue(value);

    return Array.isArray(resolved) &&
      resolved.some((source) => source.includes(nonceToken));
  });
}

export function createCspNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes));
}

function mergeSecurityPolicy(
  base: SecurityPolicy,
  override: SecurityPolicy,
): SecurityPolicy {
  return {
    csp: mergeCsp(base.csp, override.csp),
    headers: mergeSecurityHeaders(base.headers, override.headers),
    trustedTypes: override.trustedTypes ?? base.trustedTypes,
  };
}

function mergeSecurityHeaders(
  base: SecurityHeaderPolicy | undefined,
  override: SecurityHeaderPolicy | undefined,
) {
  const merged = mergeObject(base, override);

  if (!merged || override?.reportingEndpoints === false) {
    return merged;
  }

  if (base?.reportingEndpoints && override?.reportingEndpoints) {
    merged.reportingEndpoints = {
      ...base.reportingEndpoints,
      ...override.reportingEndpoints,
    };
  }

  return merged;
}

function mergeObject<T extends object>(
  base: T | undefined,
  override: T | undefined,
) {
  if (override) {
    return {
      ...(base ?? {}),
      ...override,
    };
  }

  return base;
}

function mergeCsp(
  base: ContentSecurityPolicy | false | undefined,
  override: ContentSecurityPolicy | false | undefined,
) {
  if (override === false) {
    return false;
  }

  if (!override) {
    return base;
  }

  if (!base) {
    return normalizeCsp(override);
  }

  const normalizedBase = normalizeCsp(base);
  const normalizedOverride = normalizeCsp(override);
  const merged: ContentSecurityPolicy = {
    ...normalizedBase,
    ...normalizedOverride,
  };

  for (const [name, value] of cspDirectiveEntries(override)) {
    const baseValue = resolveCspDirectiveValue(
      normalizedBase[name] as CspDirectiveValue | undefined,
    );

    if (
      !isCspDirectiveReplacement(value) &&
      Array.isArray(baseValue) &&
      Array.isArray(value)
    ) {
      setCspDirective(
        merged,
        name,
        dedupeSources([...baseValue, ...value]),
      );
    }
  }

  return merged;
}

function normalizeCsp(policy: ContentSecurityPolicy) {
  const normalized = { ...policy };

  for (const [name, value] of cspDirectiveEntries(policy)) {
    if (isCspDirectiveReplacement(value)) {
      setCspDirective(normalized, name, value.replace);
    }
  }

  return normalized;
}

function dedupeSources(sources: readonly string[]) {
  return [...new Set(sources)];
}

function setCspDirective(
  policy: ContentSecurityPolicy,
  name: keyof ContentSecurityPolicy,
  value: readonly string[],
) {
  if (name === "reportTo" || name === "upgradeInsecureRequests") {
    return;
  }

  if (name === "reportUri") {
    policy.reportUri = value as readonly ReportingEndpointUrl[];
    return;
  }

  policy[name] = value;
}

function applySecurityHeaders(
  headers: Headers,
  policy: SecurityHeaderPolicy | undefined,
  options: SecurityHeadersOptions,
) {
  if (!policy) {
    return;
  }

  setHeader(headers, "referrer-policy", policy.referrerPolicy);
  setHeader(headers, "x-content-type-options", policy.contentTypeOptions);
  setHeader(headers, "cross-origin-opener-policy", policy.crossOriginOpenerPolicy);
  setHeader(headers, "cross-origin-embedder-policy", policy.crossOriginEmbedderPolicy);
  setHeader(headers, "cross-origin-resource-policy", policy.crossOriginResourcePolicy);
  setHeader(headers, "permissions-policy", policy.permissionsPolicy);
  setHeader(
    headers,
    "reporting-endpoints",
    renderReportingEndpoints(policy.reportingEndpoints),
  );

  if (
    policy.strictTransportSecurity &&
    (!options.request || new URL(options.request.url).protocol === "https:")
  ) {
    headers.set(
      "strict-transport-security",
      renderStrictTransportSecurity(policy.strictTransportSecurity),
    );
  }
}

// `trusted-types` and `require-trusted-types-for` are CSP directives. There is
// no `trusted-types:` HTTP header, and a browser drops an unknown header
// without complaining, so emitting them standalone reads as configured and
// protects nothing.
function renderTrustedTypes(policy: TrustedTypesPolicy | false | undefined) {
  if (!policy) {
    return undefined;
  }

  const directives: string[] = [];

  if (policy.requireFor?.includes("script")) {
    directives.push("require-trusted-types-for 'script'");
  }

  if (policy.policies.length > 0) {
    directives.push(`trusted-types ${policy.policies.join(" ")}`);
  }

  return joinCspDirectives(...directives);
}

function joinCspDirectives(...parts: Array<string | undefined>) {
  const present = parts.filter((part) => part);

  return present.length > 0 ? present.join("; ") : undefined;
}

function setHeader(
  headers: Headers,
  name: string,
  value: false | string | undefined,
) {
  if (value) {
    headers.set(name, value);
  }
}

function renderStrictTransportSecurity(policy: StrictTransportSecurityPolicy) {
  const directives = [`max-age=${policy.maxAge}`];

  if (policy.includeSubDomains) {
    directives.push("includeSubDomains");
  }

  if (policy.preload) {
    directives.push("preload");
  }

  return directives.join("; ");
}

function renderCsp(
  policy: ContentSecurityPolicy,
  options: SecurityHeadersOptions,
) {
  const directives: string[] = [];

  for (const [name, value] of cspDirectiveEntries(policy)) {
    if (name === "reportTo" || name === "reportUri") {
      continue;
    }

    const resolved = resolveCspDirectiveValue(value);

    if (resolved === false || resolved === undefined) {
      continue;
    }

    const directiveName = toCspDirectiveName(name);

    // A bare `sandbox` (no tokens) is the maximally restrictive form, same
    // as an empty token list, so both render as the directive name alone.
    if (
      resolved === true ||
      (name === "sandbox" && Array.isArray(resolved) && resolved.length === 0)
    ) {
      directives.push(directiveName);
      continue;
    }

    directives.push(
      `${directiveName} ${renderCspSources(resolved, options).join(" ")}`,
    );
  }

  const reporting = renderCspReportingDirectives(policy);

  if (reporting) {
    directives.push(reporting);
  }

  return directives.join("; ");
}

function renderCspReportingDirectives(
  policy: ContentSecurityPolicy | false | undefined,
) {
  if (!policy) {
    return undefined;
  }

  const directives: string[] = [];

  const reportUri = resolveCspDirectiveValue(policy.reportUri);

  if (Array.isArray(reportUri) && reportUri.length) {
    directives.push(`report-uri ${reportUri.join(" ")}`);
  }

  if (policy.reportTo) {
    directives.push(`report-to ${policy.reportTo}`);
  }

  return joinCspDirectives(...directives);
}

function renderReportingEndpoints(
  endpoints: SecurityHeaderPolicy["reportingEndpoints"],
) {
  if (!endpoints) {
    return undefined;
  }

  return Object.entries(endpoints)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, url]) => `${name}="${escapeStructuredFieldString(url)}"`)
    .join(", ");
}

function escapeStructuredFieldString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function validateReportingConfiguration(policy: SecurityPolicy) {
  const endpoints = policy.headers?.reportingEndpoints;

  if (endpoints) {
    const entries = Object.entries(endpoints);

    if (entries.length === 0) {
      throw new Error("Demiurge Reporting-Endpoints requires at least one endpoint.");
    }

    for (const [name, url] of entries) {
      validateReportingEndpointName(name);
      validateReportingEndpointUrl(url, `Reporting-Endpoints member ${JSON.stringify(name)}`);
    }
  }

  const csp = policy.csp || undefined;

  if (csp?.reportTo) {
    validateReportingEndpointName(csp.reportTo);

    if (!endpoints || !(csp.reportTo in endpoints)) {
      throw new Error(
        `Demiurge CSP report-to group ${JSON.stringify(csp.reportTo)} is not defined in headers.reportingEndpoints.`,
      );
    }
  }

  const reportUris = resolveCspDirectiveValue(csp?.reportUri);

  for (const url of Array.isArray(reportUris) ? reportUris : []) {
    validateReportingEndpointUrl(url, "CSP report-uri target");
  }
}

function validateCspDirectiveValues(policy: ContentSecurityPolicy) {
  for (const [name, value] of cspDirectiveEntries(policy)) {
    const directive = toCspDirectiveName(name);

    if (value === undefined) {
      continue;
    }

    if (name === "reportTo") {
      if (typeof value !== "string") {
        throw new Error(
          `Demiurge CSP directive ${JSON.stringify(directive)} must be a string.`,
        );
      }

      continue;
    }

    if (name === "upgradeInsecureRequests") {
      if (typeof value !== "boolean") {
        throw new Error(
          `Demiurge CSP directive ${JSON.stringify(directive)} must be a boolean.`,
        );
      }

      continue;
    }

    if (name === "sandbox") {
      if (
        typeof value !== "boolean" &&
        (!Array.isArray(value) ||
          !value.every((token) => typeof token === "string"))
      ) {
        throw new Error(
          `Demiurge CSP directive ${JSON.stringify(directive)} must be a boolean or a list of sandbox tokens.`,
        );
      }

      continue;
    }

    const sources = resolveCspDirectiveValue(value);

    if (
      sources !== false &&
      (!Array.isArray(sources) ||
        !sources.every((source) => typeof source === "string"))
    ) {
      throw new Error(
        `Demiurge CSP directive ${JSON.stringify(directive)} must be a source list, false, or a replacement object with a source list.`,
      );
    }
  }
}

function isCspDirectiveReplacement(
  value: CspDirectiveValue | undefined,
): value is Extract<CspDirectiveValue, { replace: readonly string[] }> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "replace" in value,
  );
}

function resolveCspDirectiveValue(value: CspDirectiveValue | undefined) {
  return isCspDirectiveReplacement(value) ? value.replace : value;
}

function validateReportingEndpointName(name: string) {
  // Reporting-Endpoints is an RFC 8941 dictionary, whose member names are
  // lowercase Structured Field keys. CSP `report-to` uses the same name.
  if (!/^(?:[a-z]|\*)[a-z0-9_.*-]*$/.test(name)) {
    throw new Error(
      `Invalid reporting endpoint name ${JSON.stringify(name)}. Use a lowercase Structured Field key.`,
    );
  }
}

function validateReportingEndpointUrl(url: string, label: string) {
  if (
    !isAsciiHeaderValue(url) ||
    /[\s,;"\\]/.test(url) ||
    (!url.startsWith("/") && !url.startsWith("https://"))
  ) {
    throw new Error(`${label} must be a same-origin path or an HTTPS URL.`);
  }

  if (url.startsWith("//")) {
    throw new Error(`${label} must not be a scheme-relative URL.`);
  }

  let parsed: URL;

  try {
    parsed = new URL(url, "https://demiurge.invalid");
  } catch {
    throw new Error(`${label} must be a valid URI reference.`);
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must not contain credentials or a fragment.`);
  }
}

function isAsciiHeaderValue(value: string) {
  return /^[\x20-\x7e]+$/.test(value);
}

function cspDirectiveEntries(policy: ContentSecurityPolicy) {
  return Object.entries(policy) as Array<[
    keyof ContentSecurityPolicy,
    CspDirectiveValue | undefined,
  ]>;
}

function renderCspSources(
  sources: readonly string[],
  options: SecurityHeadersOptions,
) {
  return sources.map((source) => {
    if (!source.includes(nonceToken)) {
      return source;
    }

    if (!options.nonce) {
      throw new Error("Demiurge security policy requires a CSP nonce.");
    }

    return source.replaceAll(nonceToken, options.nonce);
  });
}

function toCspDirectiveName(name: keyof ContentSecurityPolicy) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toWebCryptoAlgorithm(algorithm: CspHashAlgorithm) {
  if (algorithm === "sha384") {
    return "SHA-384";
  }

  if (algorithm === "sha512") {
    return "SHA-512";
  }

  return "SHA-256";
}

function toBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return Buffer.from(binary, "binary").toString("base64");
}
