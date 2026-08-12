import { response } from "@demiurge/core";

export const GET = response(() => {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.append(
    "set-cookie",
    "__Host-session=alpha; Path=/; Secure; HttpOnly; SameSite=Lax",
  );
  headers.append(
    "set-cookie",
    "__Host-preference=beta; Path=/; Secure; HttpOnly; SameSite=Strict",
  );

  return new Response(JSON.stringify({ ok: true }), { headers });
});
