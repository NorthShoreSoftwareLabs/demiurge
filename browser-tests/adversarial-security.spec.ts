import { expect, test, type BrowserContext } from "@playwright/test";

const origin = "http://localhost:42187";

test("concurrent identities keep initial and browser navigation data separate", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  await Promise.all([
    setIdentity(aliceContext, "alice", "red"),
    setIdentity(bobContext, "bob", "red"),
  ]);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await Promise.all([
      alice.goto(`${origin}/secure/record`),
      bob.goto(`${origin}/secure/record`),
    ]);
    await Promise.all([
      expect(alice.getByTestId("identity")).toHaveText("alice in red"),
      expect(bob.getByTestId("identity")).toHaveText("bob in red"),
      expect(alice.locator("[data-load]")).toHaveAttribute("data-load", "1"),
      expect(bob.locator("[data-load]")).toHaveAttribute("data-load", "1"),
    ]);

    await Promise.all([
      alice.getByRole("link", { name: "Private record" }).click(),
      bob.getByRole("link", { name: "Private record" }).click(),
    ]);
    await Promise.all([
      expect(alice.getByTestId("identity")).toHaveText("alice in red"),
      expect(bob.getByTestId("identity")).toHaveText("bob in red"),
      expect(alice.locator("[data-load]")).toHaveAttribute("data-load", "1"),
      expect(bob.locator("[data-load]")).toHaveAttribute("data-load", "1"),
    ]);
  } finally {
    await Promise.all([aliceContext.close(), bobContext.close()]);
  }
});

test("an unsafe enhanced redirect fails without leaving the application", async ({ context, page }) => {
  await setIdentity(context, "alice", "red");
  await page.goto(`${origin}/redirects`);
  await expect(page.getByTestId("unsafe-redirect").locator("xpath=..")).toHaveAttribute(
    "action",
    /^javascript:/,
  );
  await page.getByTestId("unsafe-redirect").click();

  await expect(page).toHaveURL(`${origin}/redirects`);
  await expect(page.getByTestId("unsafe-result")).toContainText("unsafe redirect");
});

test("a safe enhanced redirect stays on the application origin", async ({ context, page }) => {
  await setIdentity(context, "alice", "red");
  await page.goto(`${origin}/redirects`);
  await expect(page.getByTestId("safe-redirect").locator("xpath=..")).toHaveAttribute(
    "action",
    /^javascript:/,
  );
  await page.getByTestId("safe-redirect").click();

  await expect(page).toHaveURL(`${origin}/redirects?safe=1`);
  await expect(page.getByTestId("safe-result")).toBeVisible();
});

async function setIdentity(context: BrowserContext, user: string, tenant: string) {
  await context.addCookies([
    { name: "fixture-user", url: origin, value: user },
    { name: "fixture-tenant", url: origin, value: tenant },
  ]);
}
