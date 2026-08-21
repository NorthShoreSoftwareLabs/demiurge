import { createSecureCookie, response } from "@demiurgejs/core";

export const GET = response(() => {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });

  // The default scope is "host", so Demiurge adds the `__Host-` prefix and the
  // attributes that a browser requires for that prefix.
  headers.append(
    "set-cookie",
    createSecureCookie({ name: "session", value: "alpha" }),
  );
  headers.append(
    "set-cookie",
    createSecureCookie({
      name: "preference",
      sameSite: "Strict",
      value: "beta",
    }),
  );
  // A "secure" scope shares the cookie with subdomains. It keeps Secure and
  // accepts a Domain attribute.
  headers.append(
    "set-cookie",
    createSecureCookie({ name: "tenant", scope: "secure", value: "gamma" }),
  );

  return new Response(JSON.stringify({ ok: true }), { headers });
});
