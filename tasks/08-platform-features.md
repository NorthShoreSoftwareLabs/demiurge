# Platform Features

Status: planned

## Goal

Common app platform features should be secure, typed, and compatible with the
document/security systems instead of added through unsafe snippets.

## Features To Implement

- Image optimization with local and remote source allowlists.
- Font optimization and self-hosting.
- Analytics integrations with CSP-aware script generation.
- GTM integration with trust-boundary audit warnings.
- Sentry, PostHog, Plausible, and OpenTelemetry integrations.
- Core Web Vitals reporting.
- Server-Timing headers.
- Route audit/devtools UI.

## Examples Required

- `examples/image-optimization`
- `examples/font-optimization`
- `examples/analytics`
- `examples/observability`

## Tests Required

- Unit tests for image URL validation and transform planning.
- Browser tests for script loading and web vitals beacons.
- Security tests for remote allowlist and CSP interaction.

## Open Decisions

- Whether GTM should require an explicit insecure/trust-boundary acknowledgement
  in strict security mode.
