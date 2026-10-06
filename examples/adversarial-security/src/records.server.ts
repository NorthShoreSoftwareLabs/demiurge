import "@demiurgejs/core/server-only";

export const SECRET_SENTINEL = "adversarial-server-secret-7f31c9";

const loads = new Map<string, number>();

export function readPrivateRecord(tenant: string, userId: string) {
  const key = `${tenant}:${userId}`;
  const load = (loads.get(key) ?? 0) + 1;
  loads.set(key, load);

  return {
    displayName: `${userId} in ${tenant}`,
    load,
    secret: `${SECRET_SENTINEL}:${key}`,
    tenant,
    userId,
  };
}
