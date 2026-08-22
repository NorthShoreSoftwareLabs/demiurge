// The panel declares `default-src 'none'`, and the shared CSP monitor fixture
// injects a page script. This file therefore uses the plain Playwright test.
import { expect, test } from "@playwright/test";

const developmentOrigin = "http://localhost:42179";
const productionOrigin = "http://localhost:42177";

test("the development route audit panel renders under its own policy", async ({
  page,
}) => {
  const response = await page.goto(`${developmentOrigin}/_demiurge/audit`);

  expect(response?.status()).toBe(200);

  const headers = await response?.allHeaders();

  expect(headers?.["cache-control"]).toBe("no-store");
  expect(headers?.["x-robots-tag"]).toBe("noindex");
  expect(headers?.["content-security-policy"]).toContain("default-src 'none'");
  await expect(page.locator("h1")).toHaveText("Demiurge route audit");

  const report = await page.locator("body").innerText();

  expect(report).toContain("./routes/index.tsx");
  expect(report).toContain("@policy.ts");
  expect(report).toContain("content-security-policy");
  expect(report).toContain("Cache behavior");
  await expect(page.locator("script")).toHaveCount(0);
});

test("the panel form audits another route", async ({ page }) => {
  await page.goto(`${developmentOrigin}/_demiurge/audit?path=/widgets`);

  expect(await page.locator("body").innerText()).toContain(
    "./routes/widgets/index.tsx",
  );

  await page.locator("#path").fill("/missing");
  await page.getByRole("button", { name: "Audit" }).click();

  await expect(page).toHaveURL(/path=%2Fmissing/);
  expect(await page.locator("body").innerText()).toContain(
    "No route matches /missing.",
  );
});

test("the production server does not serve the panel", async ({ request }) => {
  const response = await request.get(`${productionOrigin}/_demiurge/audit`, {
    failOnStatusCode: false,
  });

  expect(response.status()).toBe(404);
});
