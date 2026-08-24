import { page } from "@demiurgejs/core";
import { canManageSettings } from "../../../auth.server";
import type { AuthenticationContext } from "../../../session.server";

export const GET = page<
  "/settings",
  { allowed: boolean; csrfToken: string },
  AuthenticationContext
>({
  data: ({ context }) => ({
    allowed: canManageSettings(context.principal),
    csrfToken: context.csrfToken,
  }),
  view: ({ data }) => (
    <main>
      <h1>Settings</h1>
      <p>{data.allowed ? "The application policy permits access." : "Access denied."}</p>
      <form action="/logout" method="post">
        <input name="csrf-token" type="hidden" value={data.csrfToken} />
        <button type="submit">Log out</button>
      </form>
    </main>
  ),
});
