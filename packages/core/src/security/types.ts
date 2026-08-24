import type { ScriptTag } from "../document/scripts";
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
  | (string & {});

export type CspDirectiveReplacement<Source extends string = CspSource> = {
  replace: readonly Source[];
};

export type CspSourceDirective =
  | readonly CspSource[]
  | CspDirectiveReplacement
  | false;

export type CspSandboxToken =
  | "allow-downloads"
  | "allow-forms"
  | "allow-modals"
  | "allow-orientation-lock"
  | "allow-pointer-lock"
  | "allow-popups"
  | "allow-popups-to-escape-sandbox"
  | "allow-presentation"
  | "allow-same-origin"
  | "allow-scripts"
  | "allow-top-navigation"
  | "allow-top-navigation-by-user-activation"
  | "allow-top-navigation-to-custom-protocols"
  | (string & {});

/**
 * `true` renders a bare `sandbox` (the maximally restrictive sandbox). An
 * array renders `sandbox <tokens>`, relaxing only the listed capabilities.
 * `false` omits the directive.
 */
export type CspSandboxDirective = readonly CspSandboxToken[] | boolean;

export type CspDirectiveValue =
  | CspSourceDirective
  | CspSandboxDirective
  | CspDirectiveReplacement<ReportingEndpointUrl>
  | readonly ReportingEndpointUrl[]
  | boolean;

export type ContentSecurityPolicy = {
  baseUri?: CspSourceDirective;
  childSrc?: CspSourceDirective;
  connectSrc?: CspSourceDirective;
  defaultSrc?: CspSourceDirective;
  fontSrc?: CspSourceDirective;
  formAction?: CspSourceDirective;
  frameAncestors?: CspSourceDirective;
  frameSrc?: CspSourceDirective;
  imgSrc?: CspSourceDirective;
  manifestSrc?: CspSourceDirective;
  mediaSrc?: CspSourceDirective;
  objectSrc?: CspSourceDirective;
  /** Deprecated compatibility targets used alongside `reportTo`. */
  reportUri?:
    | readonly ReportingEndpointUrl[]
    | CspDirectiveReplacement<ReportingEndpointUrl>
    | false;
  /** A named member of `headers.reportingEndpoints`. */
  reportTo?: string;
  /**
   * Not part of any preset. A route that renders content it does not
   * control (user-generated HTML, a rendered comment body, an embed) opts
   * into this explicitly rather than inheriting it from `strict`/`static`.
   */
  sandbox?: CspSandboxDirective;
  scriptSrc?: CspSourceDirective;
  scriptSrcAttr?: CspSourceDirective;
  scriptSrcElem?: CspSourceDirective;
  styleSrc?: CspSourceDirective;
  styleSrcAttr?: CspSourceDirective;
  styleSrcElem?: CspSourceDirective;
  upgradeInsecureRequests?: boolean;
  workerSrc?: CspSourceDirective;
};

export type ReportingEndpointUrl = `/${string}` | `https://${string}`;

export type ReportingEndpoints = Readonly<Record<string, ReportingEndpointUrl>>;

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
  /**
   * Permits the `default` policy, which the browser applies to every raw
   * string that reaches a guarded sink. The `default` policy is one global
   * relaxation of the guarantee, so no preset turns it on. An application
   * declares it here when legacy or third-party code cannot use a named
   * policy.
   */
  allowDefaultPolicy?: boolean;
  mode: "enforce" | "report-only";
  /**
   * Policy names the document may create, beyond the framework-owned
   * `demiurge` policy that the framework always permits.
   *
   * An absent list permits the framework policy only. An empty list renders
   * `trusted-types 'none'`, which refuses every policy name.
   */
  policies?: readonly string[];
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
  field?: string;
  header?: string;
};

/**
 * A value of the `Sec-Fetch-Dest` header. The list holds the destinations that
 * a cross-site exemption usually names. Any other string stays valid.
 */
export type FetchMetadataDestination =
  | "audio"
  | "document"
  | "embed"
  | "empty"
  | "font"
  | "frame"
  | "iframe"
  | "image"
  | "manifest"
  | "object"
  | "script"
  | "style"
  | "track"
  | "video"
  | "worker"
  | (string & {});

export type FetchMetadataPolicyOptions = {
  /**
   * Allows every cross-site request. Use this for a route that intentionally
   * serves another site, such as a CORS API or a public embed.
   */
  allowCrossSite?: boolean;
  /**
   * Allows a safe top-level navigation, so a person can enter the site from a
   * link on another site. The default is `true`.
   */
  allowNavigation?: boolean;
  /**
   * Allows `Sec-Fetch-Site: same-site`. Trust of a sibling subdomain must be
   * explicit, because another team or an attacker can control that subdomain.
   */
  allowSameSite?: boolean;
  /**
   * Cross-site destinations that stay allowed, for example `"image"`.
   */
  allowedDestinations?: readonly FetchMetadataDestination[];
};

/**
 * `true` uses the default resource-isolation rules. `false` and an omitted
 * value keep the route unguarded, because the policy is opt-in.
 */
export type FetchMetadataPolicy = boolean | FetchMetadataPolicyOptions;

export type FetchMetadataReason =
  | "cors-preflight"
  | "cross-site-denied"
  | "cross-site-exempt"
  | "destination-exempt"
  | "metadata-absent"
  | "same-origin"
  | "same-site-denied"
  | "same-site-trusted"
  | "top-level-navigation"
  | "user-initiated";

export type FetchMetadataCheck = {
  allowed: boolean;
  reason: FetchMetadataReason;
  /** The `Sec-Fetch-*` fields that this decision read. */
  vary: readonly string[];
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

export type MemoryRateLimitStoreOptions = {
  maximumEntries?: number;
};

export type RateLimitStore = {
  // Synchronous for the in-memory store, which never leaves the isolate.
  // A store backed by real network I/O (KV, Redis) returns a Promise
  // instead. `enforceRateLimit` awaits the result either way.
  increment: (
    key: string,
    windowMs: number,
    now: number,
  ) => RateLimitResult | Promise<RateLimitResult>;
};

/**
 * Sources a route needs beyond its inherited policy. Each entry widens one
 * directive only, so a need never grants a source to an unrelated directive.
 */
export type RouteSecurityNeeds = {
  connect?: readonly CspSource[];
  img?: readonly CspSource[];
  script?: readonly CspSource[];
};

export type RouteSecurityPolicy = {
  csrf?: CsrfPolicy;
  fetchMetadata?: FetchMetadataPolicy;
  needs?: RouteSecurityNeeds;
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
    scriptDependencies?: boolean | ScriptDependencyAuditOptions;
    scripts?: readonly ScriptTag[];
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

export type ScriptDependencyAuditOptions = {
  allowBeforeInteractiveThirdParty?: boolean;
  requireIntegrity?: boolean;
  requirePurpose?: boolean;
};

export type SecurityHeaderPolicy = {
  contentTypeOptions?: "nosniff" | false;
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless" | false;
  crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | false;
  crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin" | false;
  permissionsPolicy?: string | false;
  referrerPolicy?: ReferrerPolicy | false;
  reportingEndpoints?: ReportingEndpoints | false;
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
  request?: Request;
};
