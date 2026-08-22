import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./fixtures";

const staticOrigin = "http://localhost:42178";

test("static output uses production React transforms", async () => {
  const assets = resolve("examples/static-export/dist/assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  const source = (await Promise.all(
    files.map(async (file) => await readFile(resolve(assets, file), "utf8")),
  )).join("\n");

  expect(files.some((file) => file.includes("jsx-dev-runtime"))).toBe(false);
  expect(source).not.toContain("react.development");
  expect(source).not.toContain("jsxDEV");
});

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

test("the self-hosted font loads under the static CSP", async ({ page }) => {
  const response = await page.goto(staticOrigin);
  const csp = response?.headers()["content-security-policy"] ?? "";

  expect(csp).toContain("font-src 'self'");
  expect(csp).not.toContain("fonts.gstatic.com");
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveAttribute(
    "href",
    "/_demiurge/font/inter-100-900-normal.woff2",
  );

  const stylesheet = await page.request.get(
    `${staticOrigin}/_demiurge/font/fonts.css`,
  );
  const fontFile = await page.request.get(
    `${staticOrigin}/_demiurge/font/inter-100-900-normal.woff2`,
  );

  expect(stylesheet.status()).toBe(200);
  expect(await stylesheet.text()).toContain(
    'url("/_demiurge/font/inter-100-900-normal.woff2")',
  );
  expect(fontFile.status()).toBe(200);
  expect(fontFile.headers()["content-type"]).toBe("font/woff2");
  await expect.poll(async () =>
    await page.evaluate(async () => {
      await document.fonts.ready;

      return document.fonts.check('16px "Inter"');
    })
  ).toBe(true);
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
