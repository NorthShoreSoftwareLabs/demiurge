import {
  defineTags,
  query,
  tag,
} from "@demiurgejs/core";
import { readMessage } from "./message-store";

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
