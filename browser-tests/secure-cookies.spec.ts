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
    httpOnly: true,
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
