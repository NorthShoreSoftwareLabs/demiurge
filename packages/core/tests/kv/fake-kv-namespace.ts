import type { EdgeKvListResult, EdgeKvNamespace } from "@demiurgejs/core/kv";

type FakeEntry = {
  expiration: number | undefined;
  value: string;
};

// A minimal, faithful in-memory implementation of the documented
// `EdgeKvNamespace` interface, used only to prove the store's logic against
// that interface. It is not shipped as a real store. A real deployment
// passes its own connected KV client, the same way `createRedisCacheStore`
// takes a connected `ioredis` client rather than owning the connection.
export function createFakeKvNamespace(
  options: { now?: () => number } = {},
): EdgeKvNamespace {
  const now = options.now ?? Date.now;
  const entries = new Map<string, FakeEntry>();

  function isExpired(entry: FakeEntry) {
    return entry.expiration !== undefined && entry.expiration * 1000 <= now();
  }

  function readValue(key: string): string | undefined {
    const entry = entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (isExpired(entry)) {
      entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  return {
    async delete(key) {
      entries.delete(key);
    },
    async get(key) {
      return readValue(key) ?? null;
    },
    async list(listOptions = {}) {
      const prefix = listOptions.prefix ?? "";
      const limit = listOptions.limit ?? 1000;
      const matching = [...entries.keys()]
        .filter((key) => key.startsWith(prefix) && readValue(key) !== undefined)
        .sort();

      const cursorIndex = listOptions.cursor
        ? matching.indexOf(listOptions.cursor) + 1
        : 0;
      const page = matching.slice(cursorIndex, cursorIndex + limit);
      const listComplete = cursorIndex + page.length >= matching.length;

      return {
        cursor: listComplete ? undefined : page[page.length - 1],
        keys: page.map((name) => ({ name })),
        list_complete: listComplete,
      } satisfies EdgeKvListResult;
    },
    async put(key, value, putOptions) {
      entries.set(key, { expiration: putOptions?.expiration, value });
    },
  };
}
