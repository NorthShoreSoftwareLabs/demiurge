# Redis Cache Adapter

This production Node example shares a `public` cache scope across Redis
instead of one process's memory. `src/cache-store.server.ts` implements the
public `CacheStore` interface with an application-owned ioredis client. A
second server replica sees the first replica's writes and invalidations.

`/posts/[id]` loads a post through `cache.get(...)` with `scope: "public"`,
tagged `posts` and `post:<id>`. The response renders a load count that only
advances when the backing loader actually runs. Two requests for the same
post render the same count, since the second read is a cache hit. A cache
miss, whether from the first request or from an invalidated entry, advances
the count.

```sh
pnpm build
redis-server --port 6379 &
NODE_ENV=production REDIS_URL=redis://127.0.0.1:6379 pnpm start
```

The server defaults to `127.0.0.1:4210`. Override `PORT`, `HOST`, and
`REDIS_URL` as needed.

Request the same post twice to see its load count hold steady:

```sh
curl -s http://127.0.0.1:4210/posts/1 | grep data-load-count
curl -s http://127.0.0.1:4210/posts/1 | grep data-load-count
```

Invalidate its tag, then request it again to see the count advance:

```sh
curl -s -X POST http://127.0.0.1:4210/api/invalidate \
  -H 'content-type: application/json' \
  -d '{"tag":"posts"}'
curl -s http://127.0.0.1:4210/posts/1 | grep data-load-count
```

`src/server-entry.ts` passes `cacheStore: { namespace, store, waitUntil }` to
the generated handler. This declaration selects the replacement. Demiurge
keeps its per-request cache facade and namespace isolation. The application
owns durability, truthful atomicity, credentials, and network failures.

The integration probe runs `verifyCacheStoreContract(...)` from
`@demiurgejs/core/data/testing` against this store. It also proves that the
suite rejects a store that falsely declares strong atomicity.

`server.js` uses `serveNodeBuild(...)` and the generated handler. This custom
server keeps the shared route and security pipeline. The application owns the
process composition and listener settings. It does not intercept application
routes before the generated handler.

`POST /api/jobs` calls ioredis directly from its mutation handler. Core has no
queue abstraction. Set `QUEUE_API_KEY` and send its value as a bearer token.
The route policy denies an invalid token before the enqueue call. The normal
mutation pipeline also keeps request security and input handling. The
application owns delivery, retries, idempotency, monitoring, and dead-letter
handling.

The [admin route group](../admin-route-group) shows an application-owned
authentication provider. Its middleware calls `authenticate(request)`, and
its policy selects `defineAuthorization(...)`. Demiurge keeps authorization
before protected application effects. Provider responsibilities include
identity proof, provider sessions, renewal, and logout.

Deploy `dist/client`, `dist/server`, `server.js`, `package.json`, and
installed production dependencies together, alongside a reachable Redis
instance.
