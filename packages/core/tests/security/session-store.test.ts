import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  type SessionNamespace,
  type SessionRecord,
  type SessionStore,
} from "@demiurgejs/core";
import { verifySessionStoreContract } from "../../src/security/testing";

describe("session store contract", () => {
  it("is satisfied by the framework memory store", async () => {
    const entries = new Map();

    await expect(
      verifySessionStoreContract((namespace) =>
        createMemorySessionStore({ entries, namespace })
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts asynchronous store methods", async () => {
    const entries = new Map();

    await expect(
      verifySessionStoreContract((namespace) =>
        asynchronousMemoryStore(namespace, entries)
      ),
    ).resolves.toBeUndefined();
  });

  it("reports the violated operation", async () => {
    const brokenStore: SessionStore<{
      authenticated: boolean;
      name: string;
    }> = {
      create: () => ({ status: "unavailable" }),
      destroy: () => false,
      read: () => undefined,
      rotate: () => ({ status: "unavailable" }),
      update: () => ({ status: "unavailable" }),
    };

    await expect(
      verifySessionStoreContract(() => brokenStore),
    ).rejects.toThrow(
      "Session store contract failed: create() must store a missing identifier.",
    );
  });
});

function asynchronousMemoryStore(
  namespace: SessionNamespace,
  entries: Map<
    string,
    SessionRecord<{ authenticated: boolean; name: string }>
  >,
): SessionStore<{ authenticated: boolean; name: string }> {
  const store = createMemorySessionStore<{
    authenticated: boolean;
    name: string;
  }>({ entries, namespace });

  return {
    async create(candidate) {
      return await store.create(candidate);
    },
    async destroy(id) {
      return await store.destroy(id);
    },
    async read(id, now) {
      return await store.read(id, now);
    },
    async rotate(currentId, candidate, expectedVersion) {
      return await store.rotate(currentId, candidate, expectedVersion);
    },
    async update(candidate, expectedVersion) {
      return await store.update(candidate, expectedVersion);
    },
  };
}
