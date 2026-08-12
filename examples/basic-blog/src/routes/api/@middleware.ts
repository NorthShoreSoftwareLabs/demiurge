import type { RouteMiddleware } from "@demiurgejs/core";

export const middleware: RouteMiddleware = async (_context, next) => {
  const response = await next();

  response.headers.set("x-demo-route-middleware", "api");

  return response;
};
