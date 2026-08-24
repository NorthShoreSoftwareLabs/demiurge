import { defineMiddleware, issueCsrfToken } from "@demiurgejs/core";
import {
  appendSessionCookies,
  sessions,
  type AuthenticationContext,
} from "../../session.server";

export const middleware = defineMiddleware<AuthenticationContext>(async (
  { context, request, url },
  next,
) => {
  const session = await sessions.open(request);
  const record = session.get();

  if (!record) {
    const target = new URL("/login", url);
    target.searchParams.set("from", url.pathname);
    const response = new Response(null, {
      headers: { location: target.toString() },
      status: 302,
    });

    return appendSessionCookies(response, await session.commit());
  }

  context.principal = record.data.principal;
  context.session = session;
  const csrf = issueCsrfToken();
  context.csrfToken = csrf.token;
  const response = await next();

  response.headers.set("cache-control", "private, no-store");
  response.headers.append("set-cookie", csrf.cookie);
  return appendSessionCookies(response, await session.commit());
});
