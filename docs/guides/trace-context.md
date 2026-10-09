# Trace context

Demiurge reads W3C Trace Context headers on Node and edge requests. Both
runtimes use the same parser and request pipeline.

## Incoming requests

Demiurge accepts a valid `traceparent` header as the remote parent of the
`demiurge.request` span. The request continues when the header is malformed.
When the header is malformed, Demiurge starts a new trace.

A valid `tracestate` header travels with its `traceparent` value. Demiurge
drops invalid `tracestate` values. The `sampled` flag stays in the parent
context when the instrumentation implementation does not record the span.
Each header has a limit of 512 characters. The `tracestate` header has a limit
of 32 entries.

The framework does not read `baggage` by default. It does not copy baggage into
span attributes. An application can set `traceContext.allowBaggage` to `true`
when its propagator needs baggage.

## Application requests

Page loaders, route mutations, and route middleware receive a `trace` carrier.
Call `trace.inject(headers)` before an application fetch to add trace headers.
The carrier uses the configured propagator when one exists.

```ts
data: async ({ trace }) => {
  const headers = new Headers();
  trace?.inject(headers);
  const response = await fetch("https://api.example.test/data", { headers });
  return await response.json();
}
```

The carrier uses the active route-data or mutation span context when instrumentation provides one.
Middleware receives the request span context.
If a span has no context, the carrier uses its parent context. The application can use the
same carrier when it schedules background work.

## Provider translation

An application can translate the validated W3C context into its provider
context and inject provider headers through `traceContext`.

```ts
const instrumentation = defineRuntimeInstrumentation({
  traceContext: {
    extract(headers, fallback) {
      return provider.extract(headers, fallback);
    },
    inject(context, headers) {
      provider.inject(context, headers);
    },
  },
});
```

Demiurge gives `extract` only validated `traceparent` and `tracestate` headers
by default. Set `allowBaggage` to `true` to give the callback the baggage
header. Provider callbacks do not change framework attributes.

An application owns baggage policy and provider behavior. Core does not add
baggage values to trusted framework attributes.

## Deployment verification

`verifyDeploymentTraceContextContract` from `@demiurgejs/core/deployment/testing`
checks trace header translation through a deployment boundary.
Its probe accepts headers and returns the parsed remote context as JSON.
If the incoming trace header is malformed, the probe returns JSON `null`.
Use this response only in a dedicated test endpoint.
The verifier checks both sampling decisions and malformed input.
The Vercel Node bridge tests run this verifier against a real HTTP listener.
