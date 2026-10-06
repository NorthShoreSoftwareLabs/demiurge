import { httpError, page, type RouteProps } from "@demiurgejs/core";
import type { FixtureContext } from "../../identity";
import { privateRecord } from "../../private-record.server";

type PublicRecord = {
  displayName: string;
  load: number;
  tenant: string;
  userId: string;
};

export const GET = page<"/secure/record", PublicRecord, FixtureContext>({
  async data({ cache, context, search }) {
    const principal = context.principal;

    if (!principal) {
      throw httpError(403, "The framework authorization hook denied access.");
    }

    const requestedTenant = search.get("tenant") ?? principal.tenant;
    if (requestedTenant !== principal.tenant) {
      throw httpError(404, "The application permission check hid the record.");
    }

    const record = await cache.get(
      privateRecord(principal.tenant, principal.userId),
    );

    return {
      displayName: record.displayName,
      load: record.load,
      tenant: record.tenant,
      userId: record.userId,
    };
  },
  view: PrivateRecordPage,
});

function PrivateRecordPage({ data }: RouteProps<"/secure/record", PublicRecord>) {
  return (
    <main data-testid="private-record">
      <h1>Private record</h1>
      <p data-testid="identity">{data.displayName}</p>
      <p data-load={data.load} data-tenant={data.tenant} data-user={data.userId}>
        Cache load {data.load}
      </p>
    </main>
  );
}
