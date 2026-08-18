# SSE Feed Example

This production Node example demonstrates the `sse(...)` response helper and
a real browser `EventSource` reading it.

```sh
pnpm build
NODE_ENV=production pnpm start
```

`/api/feed` streams four `tick` events, then ends its response. It never calls
`response.close()` on the client side, so the closed connection is a normal
server-driven close rather than an error. The browser `EventSource` spec
reconnects automatically after a close like that.

Each event carries an `id`. On reconnect, the browser sends that `id` back as
the `Last-Event-ID` header. The handler reads the header and resumes its tick
counter instead of restarting at zero. The feed on the page keeps counting up
across every reconnect.

The root page opens the `EventSource` inside a `useEffect` so it only runs
after hydration. It tracks the open connection count and the ticks it has
received. A `pnpm test:browser` run drives a real browser against the
production server. It watches the tick count pass one connection's worth of
events, and asserts more than one connection opened.

The server sets `cache-control: no-cache`, `x-accel-buffering: no`, and
`content-type: text/event-stream` on the response. Those headers matter for a
real reverse proxy. Buffering or caching an SSE response breaks the live feed
even though a direct connection to the Node process would look fine.
