import { page, type RouteProps } from "@demiurgejs/core";
import {
  readAccountRecord,
  type PublicAccount,
} from "../account-records.server";

export const GET = page({
  data: (): PublicAccount => {
    // The return statement is the browser boundary. `readAccountRecord`
    // returns `email` and `passwordHash` along with the public fields. This
    // route sends only `displayName` and `id`, because that is what the
    // return value contains.
    const record = readAccountRecord("acct-1");
    return { displayName: record.displayName, id: record.id };
  },
  view: AccountPage,
});

function AccountPage({ data }: RouteProps<"/account", PublicAccount>) {
  return (
    <main>
      <h1>{data.displayName}</h1>
      <p data-account-id={data.id}>Account {data.id}</p>
    </main>
  );
}
