import { defineAuthorization, defineRoutePolicy } from "@demiurgejs/core";
import type { AuthenticationContext } from "../../session.server";

// The group middleware resolves the session and redirects a browser to the
// log-in page. This declaration is the guarantee. It runs before a data
// loader, before a render, and before the effect of a mutation. A direct HTTP
// request therefore gets the same answer as a browser navigation.
export const policy = defineRoutePolicy({
  access: {
    authorize: defineAuthorization<Partial<AuthenticationContext>>(
      ({ context }) => Boolean(context.principal),
    ),
  },
});
