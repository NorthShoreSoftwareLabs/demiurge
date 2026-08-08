# Security Policy And CSP

Status: in progress

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
- CSRF defaults for cookie-authenticated unsafe methods.
- Rate limits, request size limits, upload limits, and webhook verification.
- Trusted Types report-only and enforce modes with diagnostics for incompatible
  libraries.
- COOP/COEP/CORP cross-origin isolation preset.
- Security audit output showing effective route policy.

## Implemented Slices

- Public `security` helpers for strict, API, and cross-origin-isolated presets.
- `createSecurityHeaders(...)` for deterministic CSP, security header, HSTS,
  and Trusted Types header rendering.
- Strict CSP nonce substitution fails closed when the nonce is missing.
- Helper-attached CORS policy, actual response CORS headers, generated
  preflight responses, and wildcard-plus-credentials validation.
- Helper-attached request body size limits enforced before route handlers read
  oversized declared bodies.
- Helper-attached request allowed-method policy enforced before route handlers
  run.
- Helper-attached fixed-window rate limits with pluggable server storage and
  dev in-memory storage.
- Explicit helper-attached CSRF protection for unsafe methods with configurable
  cookie/header token names.

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
- Whether Trusted Types starts report-only by default in strict mode or remains
  explicitly opt-in.
