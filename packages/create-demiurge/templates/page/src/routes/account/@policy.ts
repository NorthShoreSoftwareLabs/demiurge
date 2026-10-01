import { defineAuthorization, defineRoutePolicy } from "@demiurgejs/core";
import type { AuthenticationContext } from "../@middleware";

export const policy = defineRoutePolicy({
  access: {
    authorize: defineAuthorization<AuthenticationContext>(
      ({ context }) => Boolean(context.accountId),
    ),
    denyStatus: 401,
  },
});
