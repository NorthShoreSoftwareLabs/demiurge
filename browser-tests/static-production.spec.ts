import { expect, test } from "./fixtures";

const staticOrigin = "http://localhost:42178";

test("static output hydrates under its hash-based CSP", async ({ page }) => {
  const response = await page.goto(staticOrigin);
  const csp = response?.headers()["content-security-policy"] ?? "";

  expect(response?.status()).toBe(200);
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src [^;]*'sha256-[A-Za-z0-9+/=]+'/);
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'nonce-");
  const scriptSource = await page.locator("script[src]").first().getAttribute("src");
  const scriptResponse = await page.request.get(
    new URL(scriptSource ?? "", staticOrigin).href,
  );
  const publicResponse = await page.request.get(`${staticOrigin}/site.webmanifest`);

  expect(scriptResponse.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(publicResponse.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate",
  );
  await expect(
    page.getByRole("heading", {
      name: "Built once, served without an application server.",
    }),
  ).toBeVisible();

  const structuredData = await page.locator(
    'script[type="application/ld+json"]',
  ).textContent();
  const hash = await page.evaluate(async (source) => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(source),
    );
    const bytes = String.fromCharCode(...new Uint8Array(digest));

    return `'sha256-${btoa(bytes)}'`;
  }, structuredData ?? "");

  expect(csp).toContain(hash);
  await page.getByRole("link", { name: "Read the deployment guide" }).click();
  await expect(page).toHaveURL(`${staticOrigin}/guides/deployment`);
  await expect(page.getByRole("heading", { name: "Deployment" }))
    .toBeVisible();
});

test("static fallback keeps the generated security headers", async ({ page }) => {
  const response = await page.goto(`${staticOrigin}/missing-browser-route`);
  const headers = response?.headers() ?? {};

  expect(response?.status()).toBe(404);
  expect(headers["content-security-policy"]).not.toContain("'unsafe-inline'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  await expect(
    page.getByRole("heading", { name: "That page is not in this export." }),
  )
    .toBeVisible();
});
