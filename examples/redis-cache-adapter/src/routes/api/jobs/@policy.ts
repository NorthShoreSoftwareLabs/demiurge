import { defineAuthorization, defineRoutePolicy } from "@demiurgejs/core";
import type { QueueContext } from "./@middleware";

export const policy = defineRoutePolicy({
  access: {
    authorize: defineAuthorization<QueueContext>(
      ({ context }) => Boolean(context.queueAuthorized),
    ),
  },
});
