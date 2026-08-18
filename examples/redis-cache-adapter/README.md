# Redis Cache Adapter

This production Node example shares a `public` cache scope across Redis
instead of one process's memory. It uses `createRedisCacheStore(...)` from
`@demiurgejs/core/redis` as its `CacheStore`. A second server replica reading
the same Redis database sees the first replica's writes and invalidations
immediately.

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

`server.js` builds one `createRedisCacheStore(...)` from a connected
`ioredis` client and hands it to `createHandler(...)` as the framework's
shared `CacheStore`. It also builds a second `Cache` facade over the same
store, used only by the `/api/invalidate` route. Both facades share Redis
entries, so invalidation there reaches what page requests read.

Deploy `dist/client`, `dist/server`, `server.js`, `package.json`, and
installed production dependencies together, alongside a reachable Redis
instance.
