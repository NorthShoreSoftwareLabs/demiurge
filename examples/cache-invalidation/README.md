# Cache Invalidation

This example shows the one flow the cache API makes easy to get wrong: tag
invalidation triggered by an action. A page route reads a `public` cache
entry tagged `"message"`. A form POST to an action route mutates the
underlying value. It then invalidates that tag, so the next read reaches the
source instead of the stale cached one.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The server defaults to `127.0.0.1:4193`. Load `/`, note the message and the
source read counter, then submit the form. The redirect back to `/` shows the
new message. The counter advances by exactly one, proving the read after the
mutation reached the source rather than a stale cache entry.

## Why this flow is easy to get wrong

**Page `data` loaders and action handlers do not share a cache the same
way.** The framework hands a page `data` function a fresh `cache` argument on
every request. An action handler gets no `cache` argument at all. If the
action builds its own cache instance instead of reusing the page's, calling
`invalidateTags` deletes nothing from an unrelated store. `src/cache.ts`
exports one shared cache instance for exactly this reason.

**Invalidating the wrong tag fails silently.** `invalidateTags` returns a
count of deleted entries rather than throwing when nothing matched. A typo in
a tag id, or a tag the query never declares, leaves the old value cached with
no error to notice. `cacheTags.message()` is the one function both the query
and the action call, so a typo has nowhere to hide.

**Invalidating before the mutation commits creates a race.** The action in
this example writes the new message and only then invalidates the tag. An
earlier invalidation could let a concurrent read repopulate the cache with
the old value before the write finishes. That stale value would then survive
until the next explicit invalidation.

The query itself declares no `ttl`, so the message never expires on its own.
Any change the reader sees came from the action's invalidation, not from a
timer, which is what the integration test in
`tests/integration/cache-invalidation.ts` checks.

The example uses `createMemoryCache()`, which shares data only inside one
Node process. Multi-replica production deployments should inject a
distributed store that passes `verifyCacheStoreContract(...)` from
`@demiurgejs/core/data/testing`.
