import { defineAuthorization, defineRoutePolicy } from "@demiurgejs/core";
import { canManageSettings } from "../../../auth.server";
import type { AuthenticationContext } from "../../../session.server";

// A child declaration adds a restriction. Demiurge runs the group hook first
// and this hook second. Both must permit the request.
export const policy = defineRoutePolicy({
  access: {
    authorize: defineAuthorization<Partial<AuthenticationContext>>(
      ({ context }) =>
        Boolean(context.principal && canManageSettings(context.principal)),
    ),
  },
});
