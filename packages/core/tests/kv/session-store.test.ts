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
