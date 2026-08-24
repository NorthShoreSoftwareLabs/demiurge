import type {
  SessionData,
  SessionNamespace,
  SessionRecord,
  SessionStore,
  SessionStoreCandidate,
} from "./session-store";

type MaybePromise<T> = T | Promise<T>;

export type SessionStoreFactory<TData extends SessionData = SessionData> = (
  namespace: SessionNamespace,
) => MaybePromise<SessionStore<TData>>;

type ContractData = {
  authenticated: boolean;
  name: string;
};

export async function verifySessionStoreContract(
  createStore: SessionStoreFactory<ContractData>,
) {
  const token = `${Date.now()}-${Math.random()}`;
  const namespace = {
    app: `contract-${token}`,
    environment: "test",
    schemaVersion: 1,
  } satisfies SessionNamespace;
  const isolatedNamespace = {
    ...namespace,
    environment: "isolated",
  } satisfies SessionNamespace;
  const store = await createStore(namespace);
  const secondReplica = await createStore(namespace);
  const isolatedStore = await createStore(isolatedNamespace);
  const now = Date.now();
  const original = candidate(`session-${token}`, now, {
    authenticated: false,
    name: "alpha",
  });
  const rotated = candidate(`rotated-${token}`, now, {
    authenticated: true,
    name: "alpha",
  });

  try {
    assert(
      await store.read(original.id, now) === undefined,
      "read() must return undefined for a missing identifier",
    );

    const created = await store.create(original);
    assertStored(created, "create() must store a missing identifier");
    assertRecord(
      await secondReplica.read(original.id, now),
      { ...original, version: 0 },
      "create() must make a record available to another store instance",
    );

    assert(
      (await store.create(original)).status === "conflict",
      "create() must report a conflict for an existing identifier",
    );
    assert(
      await isolatedStore.read(original.id, now) === undefined,
      "a namespace must not read another namespace's record",
    );

    const isolatedCreated = await isolatedStore.create({
      ...original,
      data: { authenticated: false, name: "isolated" },
    });
    assertStored(
      isolatedCreated,
      "create() must allow the same identifier in another namespace",
    );

    const updatedCandidate = {
      ...original,
      data: { authenticated: true, name: "beta" },
    } satisfies SessionStoreCandidate<ContractData>;
    const updated = await secondReplica.update(updatedCandidate, 0);
    assertStored(updated, "update() must replace the expected version");
    assert(
      updated.record.version === 1,
      "update() must increment the stored version",
    );
    assert(
      (await store.update(original, 0)).status === "conflict",
      "update() must reject an obsolete version",
    );

    const rotations = await Promise.all([
      store.rotate(original.id, rotated, 1),
      secondReplica.rotate(
        original.id,
        { ...rotated, id: `${rotated.id}-competitor` },
        1,
      ),
    ]);
    assert(
      rotations.filter((result) => result.status === "stored").length === 1,
      "only one concurrent rotation can succeed",
    );
    assert(
      rotations.filter((result) => result.status === "conflict").length === 1,
      "one concurrent rotation must report a conflict",
    );
    assert(
      await store.read(original.id, now) === undefined,
      "rotation must invalidate the previous identifier",
    );

    const successfulRotation = rotations.find(
      (result) => result.status === "stored",
    );
    assertStored(successfulRotation, "rotation must return its stored record");
    assert(
      successfulRotation.record.version === 2,
      "rotation must increment the stored version",
    );
    assert(
      await secondReplica.destroy(successfulRotation.record.id),
      "destroy() must remove an existing identifier",
    );
    assert(
      !await store.destroy(successfulRotation.record.id),
      "destroy() must report a missing identifier",
    );

    const expired = candidate(`expired-${token}`, now, {
      authenticated: false,
      name: "expired",
    }, -1);
    assertStored(
      await store.create(expired),
      "create() must accept a record before read-time expiration checks",
    );
    assert(
      await store.read(expired.id, now) === undefined,
      "read() must not return an absolutely expired record",
    );

    const idleExpired = {
      ...candidate(`idle-${token}`, now, {
        authenticated: false,
        name: "idle",
      }),
      idleExpiresAt: now - 1,
    };
    assertStored(
      await store.create(idleExpired),
      "create() must accept a record with idle expiration",
    );
    assert(
      await store.read(idleExpired.id, now) === undefined,
      "read() must not return an idle-expired record",
    );
  } finally {
    await Promise.all([
      store.destroy(original.id),
      store.destroy(rotated.id),
      store.destroy(`${rotated.id}-competitor`),
      isolatedStore.destroy(original.id),
    ]);
  }
}

function candidate(
  id: string,
  now: number,
  data: ContractData,
  expirationOffset = 60_000,
): SessionStoreCandidate<ContractData> {
  return {
    createdAt: now,
    data,
    expiresAt: now + expirationOffset,
    id,
    idleExpiresAt: now + expirationOffset,
  };
}

function assertStored<TData extends SessionData>(
  result:
    | Awaited<ReturnType<SessionStore<TData>["create"]>>
    | undefined,
  requirement: string,
): asserts result is { record: SessionRecord<TData>; status: "stored" } {
  assert(result?.status === "stored", requirement);
}

function assertRecord<TData extends SessionData>(
  actual: SessionRecord<TData> | undefined,
  expected: SessionRecord<TData>,
  requirement: string,
) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    requirement,
  );
}

function assert(condition: boolean, requirement: string): asserts condition {
  if (!condition) {
    throw new Error(`Session store contract failed: ${requirement}.`);
  }
}
