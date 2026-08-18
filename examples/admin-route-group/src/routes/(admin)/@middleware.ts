import { defineMiddleware } from "@demiurgejs/core";

const SESSION_COOKIE = "session=1";

// Every route inside the `(admin)` group inherits this middleware, so
// `/dashboard` and `/settings` both redirect to `/login` without a session
// cookie. Neither route repeats the check on its own.
export const middleware = defineMiddleware(({ request, url }, next) => {
  if (hasSessionCookie(request)) {
    return next();
  }

  const target = new URL("/login", url);
  target.searchParams.set("from", url.pathname);

  return Response.redirect(target, 302);
});

function hasSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";

  return cookie
    .split(";")
    .map((entry) => entry.trim())
    .includes(SESSION_COOKIE);
}
