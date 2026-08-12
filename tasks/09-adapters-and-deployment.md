# Adapters And Deployment

Tracking: #11

## Goal

Deployment targets should declare capabilities so framework features fail
clearly when an adapter cannot support streaming, nonce injection, realtime, or
shared caching.

## Features To Implement

- A framework-owned `demiurge dev`/`demiurge build` interface backed by Vite,
  with route compilation, client/server boundary validation, generated types
  and transports, and a versioned provider-independent build manifest.
- Node adapter.
- Edge adapter.
- Static adapter.
- Adapter capability checks.
- Cloud Run deployment guidance.
- Typed Node origin policy with mandatory allowed hosts and explicit hop-count
  or IP-range proxy trust. Forwarded client address, scheme, and authority share
  that one trust boundary (#89, #93).
- Node lifecycle controls: production timeout defaults, request abort on client
  disconnect, readiness state, explicit signal registration, active-response
  draining, tracked background `waitUntil` work, and bounded forced shutdown
  (#94, #103, #112).
- Redis/shared cache adapter.
- KV cache adapter.
- Static output artifact generation.
- Typed deployment profiles for one codebase deployed as a Node monolith,
  replicated containers, functions, or edge workers across GCP/AWS and other
  targets.
- Separate runtime, state, and gateway integrations: Redis/DynamoDB/Firestore
  style state adapters implement core contracts; Apigee/API Gateway adapters
  emit gateway policy and normalize trusted identity rather than pretending to
  be an in-process rate-limit store.
- Deployment-time capability validation for streaming, background work, SWR
  leases, realtime protocols, and static output.

## Examples Required

- `examples/node-server`
- `examples/static-export`
- `examples/cloud-run`

## Tests Required

- Shared adapter contract tests.
- Static adapter output tests.
- Streaming capability tests.
- Cache adapter tests.

## Open Decisions

- Which Edge runtime should pressure-test the next adapter contract.
- Whether provider-specific static header translators belong in the framework
  or in small deployment packages maintained alongside it.
- Streaming, WebSocket, and shared-cache contracts need broader adapter tests.
- The first GCP and AWS pressure-test targets and the portable deployment-plan
  schema remain post-0.1 design work.

## Decisions Made

- Demiurge is the build system users configure; Vite is its compiler substrate,
  not an application-level contract. Demiurge will not implement another
  bundler. It owns client/server environment orchestration and the artifact
  contract while Vite owns transforms, HMR, assets, tree shaking, and chunks.
- The initial implementation may orchestrate separate client and server Vite
  builds. Vite's Environment API must remain behind an internal compiler
  abstraction until its framework/runtime APIs are stable enough to adopt
  without coupling applications or deployment adapters to them.
- Runtime and provider adapters consume a versioned Demiurge build manifest;
  they do not inspect Vite internals. This keeps one codebase portable across a
  monolith, GCP, AWS, and future targets.
- The static adapter is provider-independent. It emits versioned HTML artifacts
  and a deployment manifest with per-path headers rather than silently choosing
  one host's configuration format.
- Static publication stages all rendered HTML before touching the output tree,
  preserves client assets, and removes stale HTML only when a previous valid
  Demiurge manifest proves ownership.
- Static output rejects runtime page modes, per-request nonces, response
  cookies, redirects, rendering failures, unsafe paths, and inline CSP content
  without a matching stable hash.
- The Node adapter trusts no forwarding header by default. `allowedHosts` is
  mandatory; proxy trust is a discriminated hop-count or address-range policy,
  and normalized connection metadata—not caller headers—feeds IP rate limits.
- A monolith is the reference deployment, not a dead end. Provider packages may
  change runtime and state topology without changing the application route
  graph. Core rejects unsupported capability combinations instead of claiming
  every provider behaves identically.
- Gateway rate limiting complements rather than silently replaces application
  controls. Services behind Apigee/API Gateway trust identity only through the
  configured network/proxy boundary and should not remain directly reachable.
- The Node adapter owns one abort signal per request. Premature request,
  response, or socket closure aborts active route data and React streaming work
  once; loaders, middleware, handlers, and upstream clients propagate
  `request.signal` rather than creating detached work.
