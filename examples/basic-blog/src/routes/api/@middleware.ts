import { defineMiddleware } from "@demiurgejs/core";

type ApiContext = { requestId: string };

export const middleware = defineMiddleware<ApiContext>(async ({ context }, next) => {
  context.requestId = "basic-blog-api";

  const response = await next();

  response.headers.set("x-demo-route-middleware", "api");

  return response;
});
