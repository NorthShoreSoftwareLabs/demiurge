import { query } from "@demiurgejs/core";
import { readPrivateRecord } from "./records.server";

export const privateRecord = query({
  fn: (tenant: string, userId: string) => readPrivateRecord(tenant, userId),
  key: (tenant: string, userId: string) => ["private-record", tenant, userId],
  scope: "private",
  ttl: "30s",
});
