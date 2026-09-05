import { Link, page, type RouteProps } from "@demiurgejs/core";
import {
  readAccountRecord,
  type AccountRecord,
} from "../account-records.server";

// The browser receives these three fields. The loader reads the whole record,
// and the record stays on the server.
type PublicAccount = {
  displayName: string;
  id: string;
  plan: string;
};

export const GET = page<"/account", AccountRecord, PublicAccount>({
  data: () => readAccountRecord("acct-1"),
  project: (record) => ({
    displayName: record.displayName,
    id: record.id,
    plan: record.plan,
  }),
  view: AccountPage,
});

function AccountPage({ data }: RouteProps<"/account", PublicAccount>) {
  return (
    <main>
      <h1>Account</h1>
      <p data-testid="account-name">{data.displayName}</p>
      <p data-testid="account-plan">Plan: {data.plan}</p>
      <p data-testid="account-id">Account {data.id}</p>
      <Link to="/">Home</Link>
    </main>
  );
}
