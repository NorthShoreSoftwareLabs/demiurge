import { expect, test } from "./fixtures";

// The account record of the node-server example holds these server-only
// columns. The route projects three public fields, so no request that the
// browser makes may carry these strings.
const SECRET = "refresh-secret-9f2c41d0";
const PASSWORD_HASH = "argon2id$v=19$m=65536,t=3,p=4$0RcTvyGuqRXk1lJm";
const EMAIL = "ada@example.test";

test("the initial document carries only the projected account fields", async ({
  page,
}) => {
  const response = await page.goto("/account");
  const html = await response!.text();

  expect(response!.status()).toBe(200);
  expect(html).toContain("Ada Lovelace");
  expect(html).not.toContain(SECRET);
  expect(html).not.toContain(PASSWORD_HASH);
  expect(html).not.toContain(EMAIL);
  await expect(page.getByTestId("account-name")).toHaveText("Ada Lovelace");
});

test("a browser navigation carries only the projected account fields", async ({
  page,
}) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (response.request().headers()["x-demiurge-navigation"] === "data") {
      bodies.push(await response.text());
    }
  });

  await page.goto("/");
  await page.getByRole("link", { name: "View account" }).click();
  await expect(page.getByTestId("account-name")).toHaveText("Ada Lovelace");

  expect(bodies.length).toBeGreaterThan(0);
  const accountBody = bodies.find((body) => body.includes("Ada Lovelace"));
  expect(accountBody).toBeDefined();
  expect(accountBody).not.toContain(SECRET);
  expect(accountBody).not.toContain(PASSWORD_HASH);
  expect(accountBody).not.toContain(EMAIL);
});
