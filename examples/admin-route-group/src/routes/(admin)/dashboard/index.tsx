import { page } from "@demiurgejs/core";
import type { AuthenticationContext } from "../../../session.server";

export const GET = page<
  "/dashboard",
  { csrfToken: string; name: string },
  AuthenticationContext
>({
  publicData: true,
  data: ({ context }) => ({
    csrfToken: context.csrfToken,
    name: context.principal.name,
  }),
  view: ({ data }) => (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as {data.name}.</p>
      <form action="/logout" method="post">
        <input name="csrf-token" type="hidden" value={data.csrfToken} />
        <button type="submit">Log out</button>
      </form>
    </main>
  ),
});
