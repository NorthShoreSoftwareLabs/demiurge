# Platform Features

Status: in progress

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

## Implemented Slices

- `defineImages(...)`, `isAllowedImageSource(...)`, and
  `planImageTransform(...)` provide the first image optimization foundation:
  local/remote source validation, explicit remote allowlists, deterministic
  optimizer URLs, responsive variants, and loading/fetch-priority planning.
- `serverTiming(...)` attaches typed `Server-Timing` metrics to route response
  helpers, and HTTP/Vite dev request handlers append the serialized header while
  preserving app-provided timing entries.
- Script dependency audits provide the first GTM trust-boundary diagnostic
  foundation without yet implementing full analytics integration helpers.
- `classifyImageSource(...)` treats only single-slash paths as local. A
  protocol-relative source such as `//host/image.png` previously matched the
  local branch and skipped the remote allowlist entirely, so it is now rejected
  outright rather than resolved against the page origin.

## Open Decisions

- Whether GTM should require an explicit insecure/trust-boundary acknowledgement
  in strict security mode.
