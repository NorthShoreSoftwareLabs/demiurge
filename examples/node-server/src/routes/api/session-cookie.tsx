import { createSignedCookieSession, response } from "@demiurgejs/core";

const sessions = createSignedCookieSession<{
  authenticated: boolean;
  userId: string;
}>({
  cookie: { name: "account-session" },
  keys: [{ id: "browser-test", value: new Uint8Array(32).fill(37) }],
});

export const GET = response(async ({ request, url }) => {
  const session = await sessions.open(request);

  if (url.searchParams.get("login") === "1" && !session.get()) {
    session.create({ authenticated: true, userId: "browser-user" });
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
  });

  for (const cookie of await session.commit()) {
    headers.append("set-cookie", cookie);
  }

  return new Response(JSON.stringify({ session: session.get()?.data ?? null }), {
    headers,
  });
});
