# Security Policy And CSP

Tracking: #4

## Goal

Security is a first-class framework surface with strict CSP support that works
with React rendering modes instead of being left to user middleware.

## Features To Implement

- Typed `security`/`policy` helpers with app-level, layout-level, and route-level
  cascade.
- Strict production security preset.
- CSP nonce mode for dynamic SSR and streaming SSR.
- CSP hash mode for static output.
- CSP compatibility diagnostics for prerendering, streaming, and RSC.
- CORS policy helpers and generated preflight responses.
- CSRF defaults for cookie-authenticated unsafe methods, plus explicit
  high-entropy token and secure cookie issuance helpers (#92).
- Rate limits, request size limits, upload limits, and webhook verification.
- Trusted Types report-only and enforce modes with diagnostics for incompatible
  libraries.
- COOP/COEP/CORP cross-origin isolation preset.
- Security audit output showing effective route policy.
- Typed `Reporting-Endpoints`, CSP `report-to`, and compatibility `report-uri`
  configuration, including report-only delivery diagnostics (#113).

## Examples Required

- `examples/strict-csp-ssr`
- `examples/cors-api`
- `examples/webhook-security`
- `examples/trusted-types`

## Tests Required

- Unit tests for policy merge and header generation.
- Type tests for invalid CORS/CSP combinations.
- Server tests for preflight, CSRF, request size, and webhook raw-body behavior.
- Browser tests proving strict CSP does not require `unsafe-inline`.

## Open Decisions

- Exact file name for cascading security: likely `@policy.ts`.

## Future Work

- Add typed cookie creation/serialization helpers that default sensitive,
  host-only cookies to the `__Host-` prefix and require `Secure`, `Path=/`, and
  no `Domain`; support `__Secure-` when subdomain sharing is intentional and
  require `Secure`. Validate prefix invariants at runtime for JavaScript users,
  default session cookies to `HttpOnly` and an explicit `SameSite` policy, and
  document the narrow exception for JavaScript-readable double-submit CSRF
  cookies. Diagnostics should teach the naming convention rather than silently
  rewriting application cookie names (#111).

## Decisions Made

- Unsafe `POST`, `PUT`, `PATCH`, and `DELETE` requests with a non-empty Cookie
  header use double-submit CSRF validation by default (#27). Omitted policy is
  the secure default, `true` always requires validation, and `false` is the
  explicit route-policy exemption for independently authenticated endpoints.
- Trusted Types is report-only in the strict preset and enforcement is a named
  opt-in (#29). Enforcement is not build-detectable, so defaulting to it would
  fail a real session in production rather than fail a build. Strict promises
  the strongest policy that cannot break a user at runtime, and Trusted Types
  enforcement sits outside that promise.
- `report-to` is the primary CSP reporting mechanism. `report-uri` remains an
  explicit compatibility option because supporting browsers ignore it when
  `report-to` is present, while older browsers may still need it. A report-only
  audit warns when neither mechanism has a deliverable target (#113).
