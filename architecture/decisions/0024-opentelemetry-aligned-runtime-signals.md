# ADR 0024: OpenTelemetry-Aligned Runtime Signals

## Status

Accepted.

## Context

Applications need one runtime view across development, Node, and edge adapters.
Issue #274 must define that view before the framework adds pipeline signals.

Core already exports `defineInstrumentation(...)`. Its completed signals cover
requests, server startup, traces, and Web Vitals. The API has no span parent,
span identifier, propagation rule, attribute limit, or failure boundary.

The current API also awaits application handlers. A rejected handler can reach
its caller. `ObservabilityValue` permits recursive records and arrays, while
OpenTelemetry attributes permit bounded scalar values and scalar arrays.

OpenTelemetry already defines spans, context, status, sampling, and semantic
conventions. A second tracing model would add translation rules and different
failure behavior.

## Decision

### OpenTelemetry is the normative model

Demiurge uses the stable OpenTelemetry trace model for runtime operations.
The framework follows these concepts:

- A span represents a timed operation.
- A span event represents a point-in-time fact inside an operation.
- Context carries the active span and its parent relationship.
- Span status follows the OpenTelemetry status rules.
- W3C Trace Context carries trace context across network boundaries.

The framework does not model span start and span end as separate events.
An instrumentation implementation receives the span lifecycle directly.

Core does not require an OpenTelemetry SDK, provider, processor, or exporter.
The application owns these components, sampling, flush, and shutdown.

Issue #278 supplies an optional OpenTelemetry integration. A custom
instrumentation implementation remains supported.

OpenTelemetry Semantic Conventions 1.44.0 are the initial alignment point.
Demiurge adopts only stable conventions as normative behavior.

### Instrumentation ownership

Core owns these items:

- Framework operation names.
- Span relationships inside the shared pipeline.
- Safe framework attributes.
- Operation status and error classification.
- Context continuity where the runtime supports it.
- Runtime failure isolation.

The application owns these items:

- The instrumentation implementation.
- OpenTelemetry SDK registration.
- Sampling and processors.
- Exporters and resources.
- Propagation policy beyond W3C Trace Context.
- Sensitive application attributes.
- Flush and shutdown behavior.

An absent instrumentation implementation is a no-op. Framework behavior does
not depend on recording or sampling decisions.

### Runtime operations

The following operation names are stable in convention version 1.

| Operation | Kind | Parent | Required result |
| --- | --- | --- | --- |
| `demiurge.request` | server | Extracted remote context, when valid | HTTP status and duration |
| `demiurge.middleware` | internal | Request span | Outcome and duration |
| `demiurge.route.data` | internal | Request span | Outcome and duration |
| `demiurge.route.mutation` | internal | Request span | Outcome and duration |
| `demiurge.render` | internal | Request span | Render mode, outcome, and duration |
| `demiurge.cache` | internal | Owning request or background span | Cache operation and outcome |
| `demiurge.store` | client | Owning cache, session, or rate-limit span | Store operation and outcome |
| `demiurge.background` | internal | None | Outcome and duration |
| `demiurge.adapter.start` | internal | None | Runtime kind and outcome |
| `demiurge.adapter.shutdown` | internal | None | Outcome and duration |

An implementation issue can add a span operation when this table cannot
represent a separately timed framework operation. The addition must use the
versioning rules in this decision.

A span event records a fact that has no independent duration. Examples include
a cache refresh schedule and a response stream cancellation.

Node and edge adapters emit the same operations for shared request behavior.
An adapter emits process lifecycle operations only when its runtime owns that
lifecycle. Edge runtimes do not promise a shutdown operation.

### Span relationships

The inbound request span is the root framework operation. It uses the valid
remote parent when one exists.

Middleware, route data, mutations, and rendering are request children. Cache
and store spans are children of the operation that starts them.

A background operation that outlives the response uses a link to its scheduling
context. It does not extend the request span until the background work ends.
Each adapter can keep delivery alive through its declared `waitUntil` capability.
The span contract does not promise durable completion.

Core does not promise ambient context across every edge runtime. An adapter or
integration must pass context explicitly when the runtime cannot preserve it.

### HTTP alignment

The request span uses the stable OpenTelemetry HTTP server conventions where
the framework has a safe value.

| Attribute | Source | Rule |
| --- | --- | --- |
| `http.request.method` | Normalized request method | Record every request |
| `http.response.status_code` | Final response | Record when a response exists |
| `http.route` | Matched route template | Record after route matching |
| `url.scheme` | Validated request URL | Record only the scheme |
| `error.type` | Bounded framework error class | Record for an error outcome |

The request span name becomes `{method} {http.route}` after route matching.
Before matching, the name is the normalized method.

Core does not record `url.path` by default. A raw path can contain identifiers.
This privacy rule is stricter than the OpenTelemetry HTTP convention.

HTTP responses from 100 through 499 keep the server span status unset.
A 500 through 599 response sets error status. An unhandled failure also sets
error status. A successful operation does not set an explicit OK status.

Redirects and handled application errors keep the status implied by their HTTP
result. Child operations set error status only when their own work fails.

### Framework attributes

Framework attributes use the `demiurge.*` namespace. The `otel.*` namespace
remains reserved by OpenTelemetry.

Core attributes have this closed name, type, and source table for convention
version 1:

| Attribute | Type | Source |
| --- | --- | --- |
| `demiurge.operation.outcome` | string | Framework result: `success`, `error`, or `canceled` |
| `demiurge.render.mode` | string | Selected framework render mode |
| `demiurge.cache.operation` | string | Bounded framework cache operation |
| `demiurge.cache.outcome` | string | Bounded framework cache result |
| `demiurge.cache.namespace` | string | Declared cache family or namespace |
| `demiurge.store.operation` | string | Bounded framework store operation |
| `demiurge.adapter.name` | string | Registered adapter technical name |
| `demiurge.runtime.kind` | string | Runtime class: `node` or `edge` |
| `demiurge.response.body_observation` | string | Adapter capability: `completion` or `handoff` |

The operation contract can use only applicable attributes from this table.
An implementation issue must define each bounded enum before it adds the
related operation. A new enum value is additive within convention version 1.

Attribute values use the OpenTelemetry attribute value set:

- A boolean, finite number, or string.
- An array that contains one scalar type.

Core drops an invalid value. It does not convert an object or invoke an
application conversion method.

Application attributes use an `app.*` namespace. They cannot replace a
framework attribute. One span accepts at most 32 application attributes.
An attribute name accepts at most 128 Unicode code points. A string accepts at
most 1,024 Unicode code points. An array accepts at most 32 values.

Core drops an attribute that exceeds a limit. It reports one bounded diagnostic
through the instrumentation error callback. The diagnostic does not include
the rejected value.

### Redaction and cardinality

Core never records these values by default:

- Request or response bodies.
- Header values.
- Cookie names or values.
- Authorization credentials.
- Session identifiers or session records.
- Query values or fragments.
- Form or upload values.
- Raw route parameters.
- Raw cache keys or cache values.
- Store connection data.
- User, tenant, or account identifiers.
- Client network addresses.
- Error messages, causes, or stack traces.

Core uses a matched route template instead of a raw pathname. A cache span uses
a declared cache family or namespace. Each cache span excludes raw and hashed
keys.

Framework enums stay bounded. Their values come from framework declarations or
closed implementation contracts.

An application can add sensitive data through its own attributes. That choice
does not expand the values that core supplies to an attribute callback.

### Trace context and baggage

W3C `traceparent` and `tracestate` are the required wire format. Invalid input
starts a new trace and does not fail the request.

The integration preserves a valid incoming sampling decision. Sampling does
not change application behavior. An unsampled context can still propagate.

Issue #276 defines extraction, injection, and size limits. It must use the
configured OpenTelemetry propagator when the application supplies one.

Demiurge does not read or propagate baggage by default. An application can
configure baggage propagation. Core never converts baggage into attributes.

### Failures and timeouts

The new runtime span surface cannot change a response status, headers, body,
stream, cache effect, or mutation effect.

Core catches a synchronous instrumentation failure. It also contains a rejected
asynchronous delivery operation.

An application can provide one instrumentation error callback. Core calls it
with a bounded error class and operation name. Core omits the original message,
stack, attributes, and payload.

The callback cannot emit instrumentation recursively. Core ignores a callback
failure after it reports the failure to the runtime console in development.

An instrumentation implementation owns exporter timeouts. Framework operations
do not await exporter delivery. Startup can fail for an invalid static
instrumentation configuration that core can verify before traffic starts.

Core records an exception event only when an unhandled exception causes the
operation to fail. The default event contains the bounded error type only.
A configured application policy can add exception details through its own
integration.

A request span ends when its response body completes, fails, or is canceled.
An adapter that cannot observe body completion ends the span after it hands off
the response and records that capability as a bounded attribute.

### Existing public API

The current `defineInstrumentation(...)` API remains unchanged in the current
package major version. Existing handler order, awaiting, signal shapes, and
`reportWebVitals(...)` behavior remain compatible.

Failure isolation for the new runtime span surface does not change these legacy
awaiting semantics. A rejected legacy handler can still reach its caller.

The framework does not reinterpret `RequestSignal.pathname` as `http.route`.
It does not send current `ObservabilityValue` objects to the new span contract.

Issue #275 adds the new runtime span surface beside the current API. A later
major release can deprecate or adapt the completed request and trace signals.
That migration must preserve `WebVitalSignal` as a measurement contract.

`Server-Timing` response headers and analytics script integrations remain
separate features. This decision does not use them as trace transport.

### Versioning

The Demiurge runtime convention starts at version 1. The package exports the
convention version with the new runtime span surface.

These changes require a new convention major version:

- Remove or rename an operation.
- Remove or rename a required attribute.
- Change an attribute type or meaning.
- Change a parent relationship.
- Change status or redaction behavior.

These changes are additive within a convention major version:

- Add an optional attribute.
- Add a span event.
- Add an operation when consumers accept unknown operation names.

Consumers ignore unknown optional attributes, events, and operation names.
TypeScript API changes also follow package semantic versioning.

The OpenTelemetry semantic-convention alignment version is separate from the
Demiurge convention version. An update adopts only stable OpenTelemetry fields
and records the new alignment version in documentation.

## Consequences

- Issues #275 through #278 share one trace and attribute model.
- Applications can use OpenTelemetry without making its SDK a core dependency.
- Custom instrumentation remains available.
- Default signals exclude sensitive and unbounded values.
- A new runtime span implementation cannot change application success.
- The stable completed-signal API needs no immediate breaking change.
- Core must maintain its custom convention version and alignment record.

## Implementation sequence

Issue #275 adds request and route pipeline spans. It also adds parity tests for
Node and edge request behavior.

Issue #276 adds W3C context parsing and propagation. Its tests cover malformed
input, sampling preservation, and baggage isolation.

Issue #277 adds cache, store, startup, and shutdown operations. Its conformance
tests inspect the safe attributes.

Issue #278 adds the optional OpenTelemetry integration. The application owns
providers, processors, exporters, sampling, flush, and shutdown.

## References

- [OpenTelemetry library guidelines](https://opentelemetry.io/docs/specs/otel/library-guidelines/)
- [OpenTelemetry trace API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry context API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)
- [OpenTelemetry error handling](https://opentelemetry.io/docs/specs/otel/error-handling/)
- [OpenTelemetry HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [OpenTelemetry semantic naming](https://opentelemetry.io/docs/specs/semconv/general/naming/)
- [OpenTelemetry schemas](https://opentelemetry.io/docs/specs/otel/schemas/)
