import "@demiurgejs/core/server-only";
import { defineMiddleware } from "@demiurgejs/core";

export type QueueContext = { queueAuthorized?: boolean };

export const middleware = defineMiddleware<QueueContext>(
  ({ context, request }, next) => {
    const expected = process.env.QUEUE_API_KEY;
    context.queueAuthorized = Boolean(
      expected && request.headers.get("authorization") === `Bearer ${expected}`,
    );
    return next();
  },
);
