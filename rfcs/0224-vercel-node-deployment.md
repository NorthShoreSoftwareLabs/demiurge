# RFC 0224: Vercel Node deployment

## Status

Proposed for review with the implementation.
This RFC addresses [issue #224](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/224).
Provider selection belongs to [issue #410](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/410).

## Context

An application currently uses Next.js on Vercel for pages and a Resend contact endpoint.
Its migration requires a server runtime in the same deployment.
Demiurge currently generates only static Vercel artifacts.

The contact endpoint validates JSON and awaits email delivery.
It also uses application-owned bot detection and optional conversion reporting.
These integrations require server dependencies, runtime secrets, and an explicit background-work contract.

Moving the application to another Node host is possible.
However, the requested deployment should also work on its existing provider.
Provider support must preserve portable application routes and framework security guarantees.

## Decision

### Provider boundary

Select Vercel Node Functions for the first runtime integration.
Keep provider selection in deployment configuration.
Application routes continue to use Demiurge route capabilities and the Web `Request` and `Response` interfaces.

Use the shared request pipeline and Node renderer.
Retain the portable application server entry contract.
Provider code owns artifact layout, invocation transport, host metadata, and platform configuration.

The existing Node process deployment continues to own its HTTP server and shutdown sequence.
Static deployment continues to generate files without a request runtime.
Neither deployment requires Vercel credentials, configuration, or runtime dependencies.

Place provider exports under `@demiurgejs/core/vercel`.
Keep provider build dependencies optional under the existing package dependency contract.
Do not add provider concepts to route, mutation, document, or store APIs.

### Execution model

One Node Function handles application requests through the generated route map.
This includes pages, browser navigation, API routes, mutations, and application fallbacks.
Vercel serves public browser assets separately.

The initial integration renders application pages at request time.
It does not introduce ISR or mix static page generation with function rendering.
Configuration validation rejects simultaneous runtime-provider and static-output declarations.
Issue [#442](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/442) tracks hybrid route ownership.

Node 22 remains the minimum supported runtime.
Provider configuration identifies the runtime and maximum function duration.
The build validates supported configuration before it publishes an artifact.

### Capability claims

Reuse Node transport and rendering mechanisms without inheriting the Node process lifecycle claims.
Declare the function profile explicitly.

| Capability | Function profile | Reason |
| --- | --- | --- |
| `streaming` | Supported | The renderer and transport stream response chunks. |
| `nonceInjection` | Supported | The shared document pipeline creates request-specific nonces. |
| `crossOriginIsolationHeaders` | Supported | The transport preserves the response security headers. |
| `backgroundLifetime` | Unsupported | The provider owns invocation termination. |
| `requestTimeoutEnforcement` | Unsupported | Demiurge does not own the provider connection timeouts. |
| `sharedCache` | Unsupported | The application supplies shared storage. |
| `staticOutput` | Unsupported | Static generation has a separate adapter contract. |
| `webSocket` | Unsupported | This integration has no protocol upgrade contract. |
| `webTransport` | Unsupported | This integration has no transport session contract. |

Local artifact tests must prove supported mechanisms.
Live provider probes must establish how the deployed platform preserves those mechanisms.
Local test results do not establish a live deployment guarantee.

### Request integrity

Validate the request authority against explicit allowed hosts and exact platform-provided deployment hostnames.
Never infer permission from a client-supplied forwarded host.
Custom application domains require explicit configuration.

Preserve the path, query, method, body bytes, repeated cookies, and response status.
Disable provider body helpers when the framework must retain the original request stream.
Retain existing shared-pipeline body limits and validation.

Propagate provider cancellation events to `Request.signal` and the response stream.
Enable the provider cancellation setting only through its supported configuration contract.
Tests must distinguish completed requests from cancelled connections.

### Response caching

Disable provider caching for runtime responses in the first integration.
This protects nonce-bearing documents, navigation responses, mutations, and private data.
Preserve application security headers and repeated `Set-Cookie` values.

Apply asset cache rules only to static asset responses.
Static asset routing accepts `GET` and `HEAD`.
Other methods continue through the application pipeline.
Do not apply a static CORS declaration to an application endpoint.

Data cache invalidation remains independent of provider representation caching.
A later CDN caching feature must satisfy RFC 0230 and declare its representation and purge rules.

### Stores and background work

An invocation can run on any replica.
Process-local memory cannot implement a shared cache or global rate limit.
Provide an unavailable store when an application does not configure shared storage.

Reject a shared cache or rate-limit operation when no shared store exists.
Retain the existing provider-neutral store contracts.

Await the contact email operation before returning success.
Optional background work requires an application-supplied host integration.
Vercel `waitUntil` shares the function timeout and does not guarantee durable completion.
A reliable job requires an application-owned durable queue.

### Artifacts and dependencies

Generate Vercel Build Output API version 3 artifacts through the framework build command.
Publish the function and its dependency closure together with the browser assets and routing configuration.
Keep server modules, source maps, and runtime secrets outside the public asset directory.

Build into a staging directory before replacing the previous provider output.
Validate output paths before any replacement.
Remove stale artifacts only within the verified provider output directory.

Test the function after relocation outside the repository dependency tree.
Missing server dependencies must fail verification.
Native dependencies require a compatible provider build environment.
Unsupported packaging inputs must produce a specific build error.

### Application integrations

Resend remains an application dependency.
Its API key remains a server environment value.
The framework test uses a controlled email service boundary without sending email.

BotID remains a provider-specific application integration.
This adapter does not promise compatibility with a Next.js-specific BotID helper.
Migration must use a supported request-based integration or an application-selected bot protection service.

Image and font support must identify the artifact or runtime handler that serves each URL.
An unsupported optimization mode must fail before deployment.
The framework must not publish pages that reference an absent optimizer endpoint.

### Edge runtime

This integration does not support the Vercel Edge runtime.
The existing generic edge adapter remains independent.
A later integration must define its dependency, streaming, store, and lifetime boundaries separately.
Do not select an edge runtime by changing the Node function runtime string.

## Verification

Unit tests verify configuration, capability claims, host validation, cancellation, store requirements, and artifact path safety.
Production artifact tests verify SSR, navigation, contact submissions, repeated cookies, streaming, fallbacks, and asset routing.
Browser tests verify hydration, navigation, and the managed document security policy.
Packed-consumer tests verify exports, dependencies, and a relocated function.

Run the complete `pnpm verify` gate before merging implementation changes.
Record local results separately from live Vercel results in issue #411.
A release requires the normal reviewed change and signed-tag workflow.

## Provider references

- [Build Output API primitives](https://vercel.com/docs/build-output-api/primitives) define function directories and runtime configuration.
- [Request headers](https://vercel.com/docs/headers/request-headers) define provider request metadata.
- [Functions API](https://vercel.com/docs/functions/functions-api-reference) defines the cancellation opt-in.
- [Function lifetime helpers](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) define `waitUntil` limits.
- [Resend server requests](https://resend.com/docs/knowledge-base/how-do-i-fix-cors-issues) explain the server API-key boundary.
