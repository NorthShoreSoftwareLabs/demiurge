import { defineAuthorization, defineRoutePolicy } from "@demiurgejs/core";
import type { FixtureContext } from "../../identity";

export const policy = defineRoutePolicy({
  access: {
    authorize: defineAuthorization<FixtureContext>(
      ({ context }) => Boolean(context.principal),
    ),
  },
});
