# Platform Features

Tracking: #10

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
- Wire the existing typed observability dispatcher into request, Node lifecycle,
  render, action, cache/SWR, webhook, and security-report paths. Add W3C trace
  context propagation and an optional OpenTelemetry integration; vendor
  backends consume OTLP or live in separate packages.
- Future typed feature-flag and experimentation contract: request-stable
  deterministic assignment, SSR/hydration consistency, cache partitioning,
  exposure hooks, and test overrides in core; vendor SDKs in optional adapter
  packages. This is explicitly post-0.1.0 work.

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

None open.

## Decisions Made

- GTM requires an explicit trust-boundary acknowledgement in strict mode (#69).
  The script declaration is static, so the build can see it, and the enforcement
  doctrine puts detectable mistakes at the build. The acknowledgement is a named
  declaration rather than a blocker, so the marketing tag still ships without
  anyone reaching for the switch that turns strict mode off entirely.
- Feature flags and experiments follow the same core/integration boundary as
  caching. Core owns portable correctness semantics; optional provider packages
  own SDK clients and delivery. Experiment assignment is not modeled as an
  ordinary cache lookup because sticky identity and exposure semantics matter.
- `defineInstrumentation(...)` currently dispatches explicit application calls;
  it is not yet automatic framework instrumentation. OpenTelemetry supplies
  context, spans, metrics, and export conventions, while Datadog/Honeycomb are
  destinations or optional integrations rather than synonyms for
  instrumentation.
