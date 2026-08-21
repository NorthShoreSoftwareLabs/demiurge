import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const developmentOrigin = "http://localhost:42179";

async function expectViteRuntime(page: Page, csp: string | undefined) {
  // SAFETY: Vite React refresh sets the $RefreshReg$ and $RefreshSig$ globals on window during development.
  await expect.poll(() =>
    page.evaluate(() =>
      typeof (window as Window & { $RefreshReg$?: unknown }).$RefreshReg$ ===
        "function" &&
      typeof (window as Window & { $RefreshSig$?: unknown }).$RefreshSig$ ===
        "function"
    )
  ).toBe(true);

  const viteClient = page.locator('script[src="/@vite/client"]');
  await expect(viteClient).toHaveCount(1);
  // SAFETY: The locator matches a script tag, so the element is an HTMLScriptElement.
  const viteNonce = await viteClient.evaluate((element) =>
    (element as HTMLScriptElement).nonce
  );

  expect(viteNonce).not.toBe("");
  expect(csp).toContain(`'nonce-${viteNonce}'`);
  // SAFETY: The locator matches a meta tag, so the element is an HTMLMetaElement.
  const metaNonce = await page.locator('meta[property="csp-nonce"]')
    .evaluate((element) => (element as HTMLMetaElement).nonce);
  // SAFETY: The locator selects elements with a nonce attribute, so each element is an HTMLElement.
  const documentNonces = await page.locator("[nonce]").evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).nonce)
  );

  expect(metaNonce).toBe(viteNonce);
  expect(documentNonces).not.toContain("");
  expect(documentNonces.every((nonce) => csp?.includes(`'nonce-${nonce}'`)))
    .toBe(true);
  expect(documentNonces.some((nonce) => nonce.startsWith("demiurge-")))
    .toBe(false);
  await expect.poll(() =>
    page.evaluate(() =>
      performance.getEntriesByType("resource").some((entry) =>
        new URL(entry.name).pathname === "/@vite/client"
      )
    )
  ).toBe(true);
}

test("Vite development hydrates and applies the app stylesheet", async ({
  cspMonitor,
  page,
}) => {
  const failedRequests: string[] = [];
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  const response = await page.goto(developmentOrigin);

  expect(response?.status()).toBe(200);
  await expectViteRuntime(
    page,
    (await response?.allHeaders())?.["content-security-policy"],
  );
  await expect(page.getByRole("heading", {
    name: "This page was stamped by the server before you saw it.",
  })).toBeVisible();
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(244, 246, 251)",
  );

  await page.getByRole("link", { name: "Browse widgets" }).click();
  await expect(page).toHaveURL(`${developmentOrigin}/widgets`);
  await expect(page.getByRole("heading", { name: "Widgets" })).toBeVisible();

  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType("navigation").length,
  );
  expect(navigationCount).toBe(1);
  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(cspMonitor).toEqual([]);
});

test("the Vite development not-found document hydrates", async ({
  cspMonitor,
  page,
}) => {
  const failedRequests: string[] = [];
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  const response = await page.goto(`${developmentOrigin}/missing-browser-route`);

  expect(response?.status()).toBe(404);
  await expectViteRuntime(
    page,
    (await response?.allHeaders())?.["content-security-policy"],
  );
  await expect(page.getByRole("heading", {
    name: "No page at /missing-browser-route",
  })).toBeVisible();
  await page.getByRole("link", { name: "Back home" }).click();
  await expect(page).toHaveURL(`${developmentOrigin}/`);
  await expect(page.getByRole("heading", {
    name: "This page was stamped by the server before you saw it.",
  })).toBeVisible();

  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType("navigation").length,
  );
  expect(navigationCount).toBe(1);
  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(cspMonitor).toEqual([]);
});

test("Vite development streams and hydrates a late managed script", async ({
  cspMonitor,
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const response = await page.goto(`${developmentOrigin}/stream`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", {
    name: "Development streaming",
  })).toBeVisible();
  await expect(page.locator("[data-streamed]"))
    .toHaveText("The streamed content is ready.");
  const streamedScript = page.locator(
    'script[src="/assets/streamed-conditional.js"]',
  );
  await expect(streamedScript).toHaveCount(1);
  await expect(streamedScript).toHaveAttribute(
    "data-demiurge-script-placement",
    "in-place",
  );
  await expect.poll(() =>
    page.evaluate(() =>
      document.documentElement.dataset.streamedConditionalRan
    )
  ).toBe("true");
  const csp = (await response?.allHeaders())?.["content-security-policy"];
  // SAFETY: The locator matches a script tag, so the element is an HTMLScriptElement.
  const streamedScriptNonce = await streamedScript.evaluate((element) =>
    (element as HTMLScriptElement).nonce
  );
  expect(streamedScriptNonce).not.toBe("");
  expect(csp).toContain(`'nonce-${streamedScriptNonce}'`);
  await expectViteRuntime(page, csp);
  expect(pageErrors).toEqual([]);
  expect(cspMonitor).toEqual([]);
});
