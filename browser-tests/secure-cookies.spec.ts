import { expect, test } from "./fixtures";

test("Chromium accepts the prefixed cookies that createSecureCookie writes", async ({
  context,
  page,
}) => {
  const result = await page.goto("/api/cookies");

  expect(result?.status()).toBe(200);
  const cookies = await context.cookies("http://localhost:42177/");
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));

  expect(byName.get("__Host-session")).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "alpha",
  });
  expect(byName.get("__Host-preference")).toMatchObject({
    httpOnly: false,
    path: "/",
    sameSite: "Strict",
    secure: true,
    value: "beta",
  });
  expect(byName.get("__Secure-tenant")).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "gamma",
  });
});

test("the JavaScript-readable cookie reaches page script, and the HttpOnly ones do not", async ({
  page,
}) => {
  await page.goto("/api/cookies");

  const visible = await page.evaluate(() => document.cookie);

  // `readSecureCookie("preference")` reads this same string through
  // `parseCookieHeader` and `secureCookieName`, both covered directly in
  // packages/core/tests/security/cookies.test.ts.
  expect(visible).toContain("__Host-preference=beta");
  expect(visible).not.toContain("__Host-session");
  expect(visible).not.toContain("__Secure-tenant");
});

test("Chromium rejects prefixed cookies that break the invariants", async ({
  context,
  page,
}) => {
  const result = await page.goto("/api/cookie-prefix-rejection");

  expect(result?.status()).toBe(200);
  const payload = await page.evaluate(() => {
    const body = document.body.textContent ?? "{}";
    return JSON.parse(body) as { reported: string[] };
  });
  const names = (await context.cookies("http://localhost:42177/")).map(
    (cookie) => cookie.name,
  );

  expect(names).not.toContain("__Host-invalid-path");
  expect(names).not.toContain("__Host-invalid-domain");
  expect(names).not.toContain("__Secure-invalid-plain");
  // The helper reports the same three declarations before a response reaches a
  // browser, so an application does not have to find a dropped cookie.
  expect(payload.reported).toHaveLength(3);
  expect(payload.reported[0]).toContain("requires Path=/");
  expect(payload.reported[1]).toContain("cannot carry a Domain attribute");
  expect(payload.reported[2]).toContain("requires Secure");
});

test("a signed session cookie fails closed after tampering", async ({
  context,
  page,
}) => {
  await page.goto("/api/session-cookie?login=1");
  const original = (await context.cookies("http://localhost:42177/"))
    .find((cookie) => cookie.name === "__Host-account-session");

  expect(original).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });

  const authenticated = await page.evaluate(() => JSON.parse(
    document.body.textContent ?? "{}",
  ) as { session: { authenticated: boolean } | null });
  expect(authenticated.session?.authenticated).toBe(true);

  // The cookie is `s1.<key>.<payload>.<signature>`, and the signature is a
  // 32-byte HMAC in base64url. Its last character holds 4 significant bits
  // and 2 ignored bits, so a change there can decode to the same bytes and
  // still verify. Change the first character of the signature instead.
  await context.addCookies([{
    ...original!,
    value: tamperWithSignature(original!.value),
  }]);
  await page.goto("/api/session-cookie");
  const rejected = await page.evaluate(() => JSON.parse(
    document.body.textContent ?? "{}",
  ) as { session: { authenticated: boolean } | null });

  expect(rejected.session).toBeNull();
  expect(
    (await context.cookies("http://localhost:42177/"))
      .some((cookie) => cookie.name === "__Host-account-session"),
  ).toBe(false);
});

function tamperWithSignature(value: string) {
  const parts = value.split(".");
  const signature = parts[3]!;
  const first = signature[0] === "A" ? "B" : "A";
  parts[3] = `${first}${signature.slice(1)}`;
  return parts.join(".");
}
