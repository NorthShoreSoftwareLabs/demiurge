import { expect, test } from "./fixtures";

const origin = "http://localhost:42184";
const scriptSrc = "/stats/js/script.js";

test("the analytics script loads under a strict CSP without unsafe-inline", async ({
  page,
}) => {
  const beacons: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/stats/api/event")) {
      beacons.push(request.method());
    }
  });

  const response = await page.goto(origin, { waitUntil: "domcontentloaded" });
  const policy = await response?.headerValue("content-security-policy") ?? "";

  expect(response?.status()).toBe(200);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain("'unsafe-inline'");

  await expect(page.getByTestId("hydrated-marker")).toHaveText("Hydrated.");

  // The integration emits the tag through the managed script system, so the
  // framework attaches the request nonce without the application doing so.
  const analyticsScript = page.locator(`script[src="${scriptSrc}"]`);
  await expect(analyticsScript).toHaveAttribute(
    "data-api",
    "/stats/api/event",
  );
  await expect(analyticsScript).toHaveAttribute(
    "data-domain",
    "analytics-csp.example",
  );

  const nonce = await analyticsScript.evaluate(
    (element) => (element as HTMLScriptElement).nonce,
  );
  expect(nonce.length).toBeGreaterThan(0);

  // The beacon proves the effective connect-src accepted the vendor call.
  // The `cspMonitor` fixture fails this test on any violation event.
  const marker = page.getByTestId("pageview-marker");
  await expect(marker).toBeAttached({ timeout: 5_000 });
  await expect(marker).toHaveAttribute("data-status", "202");
  expect(beacons).toEqual(["POST"]);
});
