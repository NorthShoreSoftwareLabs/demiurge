import { defineRoutePolicy, response } from "@demiurgejs/core";
import {
  appendSessionCookies,
  type AuthenticationContext,
} from "../../session.server";

export const POST = response<"/logout", AuthenticationContext>(async (
  { context },
) => {
  await context.session.destroy();
  const result = new Response(null, {
    headers: { location: "/login" },
    status: 303,
  });

  return appendSessionCookies(result, await context.session.commit());
});

export const policy = defineRoutePolicy({
  security: { csrf: { field: "csrf-token" } },
});
