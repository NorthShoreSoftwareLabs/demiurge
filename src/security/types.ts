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

export type CsrfPolicy = true | {
  cookie?: string;
  header?: string;
};

export type RequestSecurityPolicy = {
  maxBodySize?: number | `${number}${"b" | "gb" | "kb" | "mb"}`;
};

export type RouteSecurityPolicy = {
  csrf?: CsrfPolicy;
  request?: RequestSecurityPolicy;
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

export type SecurityPreset = "api" | "cross-origin-isolated" | "strict";

export type SecurityHeadersOptions = {
  nonce?: string;
};
