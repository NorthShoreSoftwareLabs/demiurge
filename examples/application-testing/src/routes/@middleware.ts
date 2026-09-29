import { defineMiddleware } from "@demiurgejs/core";

export const middleware = defineMiddleware(async (_context, next) => {
  const response = await next();
  response.headers.set("x-application-middleware", "active");
  return response;
});
