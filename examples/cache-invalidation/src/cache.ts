import {
  createInvalidation,
  createMemoryCache,
  defineTags,
  query,
  tag,
} from "@demiurgejs/core";
import { readMessage } from "./message-store";

// A page `data` loader receives a fresh `cache` from the framework on every
// request. A mutation route receives no `cache` at all. Reading and
// invalidating the same tagged entry needs one shared cache, so this module
// exports a single instance instead of relying on the framework-injected one.
export const cache = createMemoryCache();

export const invalidation = createInvalidation(cache);

export const cacheTags = defineTags({
  message: () => tag("message"),
});

// No `ttl` means this entry never expires on its own. The only way the page
// ever sees a new value is an explicit tag invalidation, which keeps the
// example honest about what invalidation actually proves.
export const messageQuery = query({
  fn: () => readMessage(),
  key: () => ["cache-invalidation", "message"],
  scope: "public",
  tags: () => [cacheTags.message()],
});
