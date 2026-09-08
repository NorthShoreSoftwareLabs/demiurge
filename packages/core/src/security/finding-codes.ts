/**
 * The diagnostic code vocabulary of Demiurge.
 *
 * ADR 0018 gives the build verifier and the runtime audit one vocabulary. A
 * code names one condition. The build verifier reports a subset of the codes,
 * because the build cannot read a value that only a request supplies.
 */
export type SecurityFindingCode =
  /** The route inherits no access declaration. */
  | "access-declaration-missing"
  /** The route runs each inherited authorization hook. */
  | "access-authorized"
  /** An access exception removed each inherited authorization hook. */
  | "access-exception"
  /** The route declares public access. */
  | "access-public"
  /** The CORS policy is invalid. */
  | "cors-invalid"
  /** The CORS policy names a method that the route does not serve. */
  | "cors-method-unavailable"
  /** The document accepts no Content-Security-Policy. */
  | "csp-disabled"
  /** A document script needs a nonce for the effective script-src policy. */
  | "csp-script-missing-nonce"
  /** The effective script-src policy blocks a document script. */
  | "csp-script-src-blocked"
  /** The route accepts no CSRF check for an unsafe method. */
  | "csrf-disabled"
  /** The route inherits no document policy. */
  | "document-policy-missing"
  /** The rate limit policy is invalid. */
  | "rate-limit-invalid"
  /** The unsafe route declares no rate limit. */
  | "rate-limit-missing"
  /** Trusted Types report-only mode has no deliverable target. */
  | "report-only-target-missing"
  /** The route raises the inherited request body limit. */
  | "request-body-limit-raised"
  /** Google Tag Manager is a wide trust boundary. */
  | "script-gtm-wide-trust-boundary"
  /** A third-party script declares no integrity hash. */
  | "script-integrity-missing"
  /** A third-party script declares no purpose. */
  | "script-purpose-missing"
  /** A third-party script runs before the application is interactive. */
  | "script-third-party-before-interactive"
  /** A security exception states no reason. */
  | "security-exception-reason-missing"
  /** The security headers failed to render. */
  | "security-header-render-failed";

/**
 * The codes that the build verifier reports. Each code is a member of
 * `SecurityFindingCode`.
 */
export type StaticPolicyFindingCode = Extract<
  SecurityFindingCode,
  | "access-declaration-missing"
  | "cors-invalid"
  | "cors-method-unavailable"
  | "document-policy-missing"
  | "rate-limit-invalid"
  | "security-exception-reason-missing"
  | "security-header-render-failed"
>;
