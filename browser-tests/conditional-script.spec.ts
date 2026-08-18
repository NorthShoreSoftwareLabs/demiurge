import { expect, test } from "./fixtures";

const origin = "http://localhost:42181";
const analyticsSrc = "/vendor/analytics";

test("the home route never requests the analytics script", async ({ page }) => {
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(analyticsSrc)) {
      analyticsRequests.push(request.url());
    }
  });

  const response = await page.goto(origin);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Conditional script example" }))
    .toBeVisible();
  await page.waitForTimeout(600);

  expect(analyticsRequests).toEqual([]);
  expect(await page.locator('script[src="/vendor/analytics"]').count())
    .toBe(0);
});

test("the dashboard route skips the script without consent", async ({ page }) => {
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(analyticsSrc)) {
      analyticsRequests.push(request.url());
    }
  });

  await page.goto(`${origin}/dashboard`);

  await expect(page.getByTestId("consent-status")).toHaveText(
    "Consent not granted.",
  );
  await page.waitForTimeout(600);

  expect(analyticsRequests).toEqual([]);
  expect(await page.getByTestId("analytics-marker").count()).toBe(0);
});

test("the dashboard route loads the script after consent without blocking hydration", async ({
  page,
}) => {
  const response = await page.goto(`${origin}/dashboard?consent=granted`, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(200);
  expect(await response?.headerValue("content-security-policy")).toContain(
    "'strict-dynamic'",
  );

  await expect(page.getByTestId("consent-status")).toHaveText(
    "Consent granted.",
  );

  // Hydration finishes, and the marker text updates, before the
  // artificially slow analytics script has had time to arrive.
  await expect(page.getByTestId("hydrated-marker")).toHaveText("Hydrated.");
  expect(await page.getByTestId("analytics-marker").count()).toBe(0);

  await expect(page.getByTestId("analytics-marker")).toBeAttached({
    timeout: 5_000,
  });

  const analyticsScript = page.locator('script[src="/vendor/analytics"]');
  await expect(analyticsScript).toHaveAttribute("async", "");

  const analyticsNonce = await analyticsScript.evaluate(
    (element) => (element as HTMLScriptElement).nonce,
  );
  expect(analyticsNonce.length).toBeGreaterThan(0);
});
