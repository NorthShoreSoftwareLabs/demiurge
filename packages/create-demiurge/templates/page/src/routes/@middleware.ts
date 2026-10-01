import { defineMiddleware } from "@demiurgejs/core";

export type AuthenticationContext = { accountId?: string };

export const middleware = defineMiddleware<AuthenticationContext>(
  ({ context, request }, next) => {
    context.accountId = request.headers.get("x-account-id") ?? undefined;
    return next();
  },
);
