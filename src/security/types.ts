import type { HttpMethod } from "../route/types";

export type CspSource =
  | "'self'"
  | "'none'"
  | "'unsafe-inline'"
  | "'unsafe-eval'"
  | "'strict-dynamic'"
  | "data:"
  | "blob:"
  | "https:"
  | "http:"
  | string;

export type CspDirectiveValue = readonly CspSource[] | boolean;

export type ContentSecurityPolicy = {
  baseUri?: readonly CspSource[];
  connectSrc?: readonly CspSource[];
  defaultSrc?: readonly CspSource[];
  fontSrc?: readonly CspSource[];
  formAction?: readonly CspSource[];
  frameAncestors?: readonly CspSource[];
  imgSrc?: readonly CspSource[];
  objectSrc?: readonly CspSource[];
  scriptSrc?: readonly CspSource[];
  styleSrc?: readonly CspSource[];
  upgradeInsecureRequests?: boolean;
};

export type ReferrerPolicy =
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

export type StrictTransportSecurityPolicy = {
  includeSubDomains?: boolean;
  maxAge: number;
  preload?: boolean;
};

export type TrustedTypesPolicy = {
  mode: "enforce" | "report-only";
  policies: readonly string[];
  requireFor?: readonly ["script"];
};

export type CorsPolicy = {
  credentials?: boolean;
  exposeHeaders?: readonly string[];
  headers?: readonly string[];
  maxAge?: number;
  methods?: readonly HttpMethod[];
  origins: "*" | readonly string[];
};

export type CorsRequestContext = {
  request: Request;
};

export type CorsResponseOptions =
  | {
    methods: readonly HttpMethod[];
    preflight: true;
  }
  | {
    methods?: readonly HttpMethod[];
    preflight?: false;
  };

export type CsrfPolicy = false | true | {
  cookie?: string;
  header?: string;
};

export type RequestSecurityPolicy = {
  allowedMethods?: readonly HttpMethod[];
  maxBodySize?: number | `${number}${"b" | "gb" | "kb" | "mb"}`;
};

export type RateLimitKey = "ip" | {
  header: string;
};

export type RateLimitPolicy = {
  key: RateLimitKey;
  limit: number;
  window: number | `${number}${"h" | "m" | "s"}`;
};

export type RateLimitResult = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  increment: (
    key: string,
    windowMs: number,
    now: number,
  ) => RateLimitResult;
};

export type RouteSecurityPolicy = {
  csrf?: CsrfPolicy;
  rateLimit?: RateLimitPolicy;
  request?: RequestSecurityPolicy;
};

export type RoutePolicy = {
  document?: SecurityPolicy;
  security?: RouteSecurityPolicy;
};

export type SecurityAuditFinding = {
  code: string;
  message: string;
  severity: "error" | "info" | "warning";
};

export type SecurityAuditOptions = {
  document?: {
    headers?: SecurityHeadersOptions;
    policy: SecurityPolicy;
  };
  route?: {
    cors?: CorsPolicy;
    method: HttpMethod;
    security?: RouteSecurityPolicy;
  };
};

export type SecurityAudit = {
  findings: SecurityAuditFinding[];
  headers: Record<string, string>;
  route?: SecurityAuditOptions["route"];
};

export type SecurityHeaderPolicy = {
  contentTypeOptions?: "nosniff" | false;
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless" | false;
  crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | false;
  crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin" | false;
  permissionsPolicy?: string | false;
  referrerPolicy?: ReferrerPolicy | false;
  strictTransportSecurity?: StrictTransportSecurityPolicy | false;
};

export type SecurityPolicy = {
  csp?: ContentSecurityPolicy | false;
  headers?: SecurityHeaderPolicy;
  trustedTypes?: TrustedTypesPolicy | false;
};

export type SecurityPreset = "api" | "cross-origin-isolated" | "static" | "strict";
export type CspHashAlgorithm = "sha256" | "sha384" | "sha512";

export type SecurityHeadersOptions = {
  nonce?: string;
};
