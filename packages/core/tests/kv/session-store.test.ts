import { describe, expect, it } from "vitest";
import {
  createKvSessionStore,
  type EdgeKvAtomicOperation,
  type EdgeKvSessionNamespace,
} from "@demiurgejs/core/kv";
import { verifySessionStoreContract } from "../../src/security/testing";

describe("createKvSessionStore", () => {
  it("satisfies the session store contract", async () => {
    const store = memoryAtomicNamespace();

    await expect(
      verifySessionStoreContract((namespace) =>
        createKvSessionStore({ namespace, store })
      ),
    ).resolves.toBeUndefined();
  });

  it("requires an atomic provider boundary", () => {
    expect(() =>
      createKvSessionStore({
        namespace: { app: "test", environment: "test", schemaVersion: 1 },
        // @ts-expect-error this incomplete provider verifies the startup diagnostic.
        store: { delete: async () => {}, get: async () => null },
      })
    ).toThrow("requires atomic compare-and-swap operations");
  });

  it("treats a corrupted stored record as absent rather than throwing", async () => {
    const store = memoryAtomicNamespace();
    const namespace = { app: "test", environment: "test", schemaVersion: 1 };
    const sessionStore = createKvSessionStore({ namespace, store });
    const key = "demiurge:session:test:test:1:corrupted";

    await store.put(key, JSON.stringify({ not: "a valid session record" }));

    await expect(sessionStore.read("corrupted", Date.now())).resolves
      .toBeUndefined();
  });

  it("reports a conflict, not an outage, when update() targets a corrupted record", async () => {
    const store = memoryAtomicNamespace();
    const namespace = { app: "test", environment: "test", schemaVersion: 1 };
    const sessionStore = createKvSessionStore({ namespace, store });
    const key = "demiurge:session:test:test:1:corrupted";

    await store.put(key, JSON.stringify({ not: "a valid session record" }));

    const now = Date.now();
    const result = await sessionStore.update(
      {
        createdAt: now,
        data: {},
        expiresAt: now + 60_000,
        id: "corrupted",
      },
      0,
    );

    expect(result.status).toBe("conflict");
  });

  it("reports unavailable when the underlying store throws", async () => {
    const namespace = { app: "test", environment: "test", schemaVersion: 1 };
    const sessionStore = createKvSessionStore({
      namespace,
      store: {
        atomic: async () => {
          throw new Error("connection reset");
        },
        delete: async () => {},
        get: async () => null,
        list: async () => ({ keys: [], list_complete: true }),
        put: async () => {},
      },
    });

    const now = Date.now();
    const result = await sessionStore.create({
      createdAt: now,
      data: {},
      expiresAt: now + 60_000,
      id: "unavailable-check",
    });

    expect(result.status).toBe("unavailable");
  });
});

function memoryAtomicNamespace(): EdgeKvSessionNamespace {
  const entries = new Map<string, string>();

  return {
    async atomic(operations) {
      if (operations.some((operation) =>
        (entries.get(operation.key) ?? null) !== operation.expected
      )) {
        return false;
      }

      for (const operation of operations) {
        applyOperation(entries, operation);
      }

      return true;
    },
    async delete(key) {
      entries.delete(key);
    },
    async get(key) {
      return entries.get(key) ?? null;
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      return {
        keys: [...entries.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      };
    },
    async put(key, value) {
      entries.set(key, value);
    },
  };
}

function applyOperation(
  entries: Map<string, string>,
  operation: EdgeKvAtomicOperation,
) {
  if (operation.write) {
    entries.set(operation.key, operation.write.value);
  } else {
    entries.delete(operation.key);
  }
}
