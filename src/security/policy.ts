import type {
  ContentSecurityPolicy,
  CspDirectiveValue,
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

const strictHeaders = {
  contentTypeOptions: "nosniff",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  permissionsPolicy: "camera=(), microphone=(), geolocation=(), payment=()",
  referrerPolicy: "strict-origin-when-cross-origin",
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

    return security.strict(options);
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

export function createSecurityHeaders(
  policy: SecurityPolicy,
  options: SecurityHeadersOptions = {},
) {
  const headers = new Headers();

  if (policy.csp !== false && policy.csp) {
    headers.set("content-security-policy", renderCsp(policy.csp, options));
  }

  applySecurityHeaders(headers, policy.headers);
  applyTrustedTypesHeaders(headers, policy.trustedTypes);

  return headers;
}

function mergeSecurityPolicy(
  base: SecurityPolicy,
  override: SecurityPolicy,
): SecurityPolicy {
  return {
    csp: mergeOptionalObject(base.csp, override.csp),
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

function mergeOptionalObject<T extends object>(
  base: T | false | undefined,
  override: T | false | undefined,
) {
  if (override === false) {
    return false;
  }

  if (override) {
    return {
      ...(base === false || !base ? {} : base),
      ...override,
    };
  }

  return base;
}

function applySecurityHeaders(
  headers: Headers,
  policy: SecurityHeaderPolicy | undefined,
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

  if (policy.strictTransportSecurity) {
    headers.set(
      "strict-transport-security",
      renderStrictTransportSecurity(policy.strictTransportSecurity),
    );
  }
}

function applyTrustedTypesHeaders(
  headers: Headers,
  policy: TrustedTypesPolicy | false | undefined,
) {
  if (!policy) {
    return;
  }

  const trustedTypesValue = policy.policies.join(" ");
  const trustedTypesHeader = policy.mode === "report-only"
    ? "trusted-types-report-only"
    : "trusted-types";

  headers.set(trustedTypesHeader, trustedTypesValue);

  if (policy.requireFor?.includes("script")) {
    headers.set("require-trusted-types-for", "'script'");
  }
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
