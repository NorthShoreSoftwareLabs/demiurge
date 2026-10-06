import { defineMiddleware } from "@demiurgejs/core";
import type { FixtureContext } from "../identity";

export const middleware = defineMiddleware<FixtureContext>(async (
  { context, request },
  next,
) => {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) {
      cookies.set(
        part.slice(0, separator).trim(),
        part.slice(separator + 1).trim(),
      );
    }
  }
  const userId = request.headers.get("x-fixture-user") ?? cookies.get("fixture-user");
  const tenant = request.headers.get("x-fixture-tenant") ??
    cookies.get("fixture-tenant");

  if (userId && tenant) {
    context.principal = { tenant, userId };
  }

  return next();
});
