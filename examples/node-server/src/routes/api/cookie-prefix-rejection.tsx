import { createSecureCookie, response } from "@demiurgejs/core";

// This route proves that the browser enforces the cookie prefix rules that
// `createSecureCookie(...)` reports. It writes the invalid headers by hand,
// because the helper refuses to serialize them. Do not copy this route into an
// application. It exists only for the browser conformance test.
const rejectedByTheBrowser = [
  // A `__Host-` cookie requires Path=/.
  "__Host-invalid-path=one; Path=/api; Secure; HttpOnly; SameSite=Lax",
  // A `__Host-` cookie cannot carry a Domain attribute.
  "__Host-invalid-domain=two; Path=/; Domain=localhost; Secure; HttpOnly; SameSite=Lax",
  // A `__Secure-` cookie requires Secure.
  "__Secure-invalid-plain=three; Path=/; HttpOnly; SameSite=Lax",
];

export const GET = response(() => {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  const reported: string[] = [];

  for (const cookie of rejectedByTheBrowser) {
    headers.append("set-cookie", cookie);
  }

  // The same declarations reach the application as diagnostics rather than as
  // dropped cookies.
  for (const declaration of [
    { name: "invalid-path", path: "/api", value: "one" },
    { domain: "localhost", name: "invalid-domain", value: "two" },
    { name: "invalid-plain", scope: "secure" as const, secure: false, value: "three" },
  ]) {
    try {
      createSecureCookie(declaration);
    } catch (error) {
      reported.push(error instanceof Error ? error.message : String(error));
    }
  }

  return new Response(JSON.stringify({ reported }), { headers });
});
