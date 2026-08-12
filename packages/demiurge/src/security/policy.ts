import type {
  ContentSecurityPolicy,
  CspHashAlgorithm,
  CspDirectiveValue,
  RoutePolicy,
  RouteSecurityPolicy,
  SecurityHeadersOptions,
  SecurityHeaderPolicy,
  SecurityPolicy,
  SecurityPreset,
  StrictTransportSecurityPolicy,
  TrustedTypesPolicy,
} from "./types";

const nonceToken = "{nonce}";

const strictCsp = {
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  defaultSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:", "blob:"],
  objectSrc: ["'none'"],
  scriptSrc: [`'nonce-${nonceToken}'`, "'strict-dynamic'"],
  styleSrc: ["'self'", `'nonce-${nonceToken}'`],
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
  return policies.reduce<RoutePolicy>((merged, policy) => {
    if (!policy) {
      return merged;
    }

    return {
      document: mergeSecurityPolicies(merged.document, policy.document),
      security: mergeRouteSecurityPolicies(merged.security, policy.security),
    };
  }, {});
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
      rateLimit: policy.rateLimit ?? merged.rateLimit,
      request: mergeObject(merged.request, policy.request),
    };
  }, {});
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
    reportsTrustedTypes ? trustedTypes : undefined,
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

  return cspDirectiveEntries(policy.csp).some(([, value]) =>
    Array.isArray(value) && value.some((source) => source.includes(nonceToken))
  );
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
    headers: mergeObject(base.headers, override.headers),
    trustedTypes: override.trustedTypes ?? base.trustedTypes,
  };
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
    return override;
  }

  const merged: ContentSecurityPolicy = {
    ...base,
    ...override,
  };

  for (const [name, value] of cspDirectiveEntries(override)) {
    const baseValue = base[name];

    if (Array.isArray(baseValue) && Array.isArray(value)) {
      setCspDirective(merged, name, dedupeSources([...baseValue, ...value]));
    }
  }

  return merged;
}

function dedupeSources(sources: readonly string[]) {
  return [...new Set(sources)];
}

function setCspDirective(
  policy: ContentSecurityPolicy,
  name: keyof ContentSecurityPolicy,
  value: readonly string[],
) {
  if (name === "upgradeInsecureRequests") {
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
    if (value === false || value === undefined) {
      continue;
    }

    const directiveName = toCspDirectiveName(name);

    if (value === true) {
      directives.push(directiveName);
      continue;
    }

    directives.push(`${directiveName} ${renderCspSources(value, options).join(" ")}`);
  }

  return directives.join("; ");
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
