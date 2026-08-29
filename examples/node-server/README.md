# Demiurge Node Server

This example builds a client bundle and an SSR server bundle, then serves both
through the production Node adapter.

The `/localized` route uses i18next through an application-owned message helper.
Its locale switch uses the framework `Link` locale option.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The server serves hashed client assets and the emitted stylesheet from
`dist/client`. The framework-owned SSR server entry renders page requests. The
root page includes server-loaded data. `/api/items` remains a regular JSON route.
`/api/private` returns a typed RFC 9457 problem with a 401 status and a
`WWW-Authenticate` challenge. `/stream` uses `render.mode: "streaming"`. Its
Suspense fallback arrives in the shell before the lazy component resolves.

`/api/fetch-metadata-guarded` opts into the Fetch Metadata resource-isolation
policy. It answers a same-origin request and a top-level navigation, and it
answers every other cross-site request with status 403.
`/api/fetch-metadata-open` declares the cross-site exemption that an intended
CORS resource needs. Both routes add a `Vary` field for each `Sec-Fetch-*`
header that the decision reads.

The `/items` page also demonstrates cancellation-safe upstream work. Its data
loader passes `request.signal` to `fetch(...)`, so the production Node adapter
stops the upstream request if the browser disconnects before the page is ready.
Middleware and route handlers receive the same request signal and should pass it
to databases and SDKs that accept an `AbortSignal`.

`server.js` also injects a process-shared memory `CacheStore`. The root page's
public data query is fresh for five seconds. It then serves its last good value
during a thirty-second stale period. One coordinated refresh runs. The
cache passes that refresh promise to `server.waitUntil(...)`, so SIGINT/SIGTERM
shutdown drains it within the configured grace period rather than abandoning
publication. Every request still gets its own cache facade. The memory store is
intentionally limited to one Node process. A deployment with multiple replicas
should inject a shared Redis or KV implementation that passes
`@demiurgejs/core/data/testing`'s contract.

`/hero` renders an `Image` with the request-time optimizer. `server.js`
composes `createImageOptimizer(...)` in front of the static file handler. The
optimizer resizes and reencodes each variant on request. It negotiates AVIF or
WebP from the `accept` header. It answers a repeat request with an entity tag.

The site declares Inter in `src/fonts.ts` and self-hosts it. `server.js`
composes `createFontAssetHandler(...)` in front of the static file handler. The
handler serves the font file and one `@font-face` stylesheet from
`/_demiurge/font`, and `fontSources(fonts)` keeps `font-src` at `'self'`. Inter
ships under the SIL Open Font License, and `fonts/inter-latin.LICENSE.txt`
carries that license.

The client build emits `dist/client/demiurge-manifest.json`. `server.js` reads
its hashed entry and stylesheet paths and passes them to the generated
`createHandler(...)`. The SSR build compiles `src/server-entry.ts` to
`dist/server/server-entry.js`.

Deploy `dist/client`, `dist/server`, `server.js`, `package.json`, and installed
production dependencies together. The server defaults to `127.0.0.1:4173`.
Override `PORT` as needed and set `HOST=0.0.0.0` when a container or platform
must connect directly to the process.
