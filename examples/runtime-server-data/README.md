# Runtime Server Data

This production Node example fetches an ordinary JSON route over HTTP from a
page `data` loader, then makes the source counters visible in the rendered
document. It demonstrates:

- `public` data reused across requests until a two-second TTL expires;
- `private` data partitioned by the `x-demo-account` value in its cache key;
- two `request` reads deduped inside one request but reloaded next request;
- two `none` reads both reaching the source;
- a shared store injected into a fresh cache facade for every request.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The server defaults to `127.0.0.1:4192`. Reload `/` quickly to see public and
private counters remain stable while request and none counters advance. Wait
more than two seconds and reload to see public data refresh. Send
`x-demo-account: ada` to demonstrate a separate private key.

The example uses `createMemoryCacheStore()`, which shares data only inside one
Node process. Multi-replica production deployments should inject a distributed
store that passes `verifyCacheStoreContract(...)` from
`demiurge/data/testing`.
