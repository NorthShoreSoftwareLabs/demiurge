# Observability Example

This example demonstrates `serverTiming(...)` end to end. `GET /api/timings`
runs a simulated database query and a simulated cache lookup, times each
step, and reports the results in a `Server-Timing` response header.

Run the example with:

```sh
pnpm build
pnpm start
```

Request the timed route:

```sh
curl -si "http://127.0.0.1:4211/api/timings"
```

The response carries a header like this, with real measured durations:

```
server-timing: db;dur=41.2;desc="simulated database query", cache;dur=9.8;desc="simulated cache lookup"
```

## Why response(...) builds the header

`json(...)` and the other response helpers accept a `timing` option, but that
option is fixed once, when the route module loads. It suits a metric a route
always wants to report. It cannot carry a duration measured during the
request being served.

`/api/timings` builds its own `Response` with `response(...)` instead. The
handler measures each step and passes the results to `serverTiming(...)`.
That builds a validated metric list. The handler writes that list into the
`Server-Timing` header of the `Response` it returns. See
[`src/routes/api/timings.tsx`](./src/routes/api/timings.tsx).

`pnpm test:examples` runs an integration probe against the route. It parses
the `Server-Timing` header from the real HTTP response. It confirms the
`db` and `cache` metrics are present, each with a duration at least as long
as the artificial delay that step introduces.

## How a real backend consumes this header

`Server-Timing` is a standard response header. A browser's devtools Network
panel reads it without any setup, showing each named metric next to the
request in the Timing tab. A reverse proxy or an APM agent sitting in front
of the server can read the same header from every response. It can then
forward the metrics to a tracing backend, and the application code never
needs to know that backend exists. This example proves the header itself
is correct and parseable. Wiring a specific vendor's collector in front of
it is a deployment concern, not a framework one.
