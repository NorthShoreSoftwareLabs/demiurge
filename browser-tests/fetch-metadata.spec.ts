import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The Node example serves the guarded routes. The CORS client example serves a
// page on a second port of the same host, which a browser reports as
// `same-site`. A route intercepted by Playwright gives a real `cross-site`
// origin without a further example server.
const guardedUrl = "http://localhost:42177/api/fetch-metadata-guarded";
const openUrl = "http://localhost:42177/api/fetch-metadata-open";
const sameSitePageUrl = "http://localhost:42183/";
// A loopback host keeps the page inside the local network. Chromium blocks a
// subresource request from a public page to a loopback address. `127.0.0.1`
// and `localhost` are still different sites, so the browser reports
// `cross-site`.
const crossSitePageUrl = "http://127.0.0.1:42175/";

// Every server in this suite listens on a loopback address. Chromium blocks a
// cross-origin subresource request into the loopback address space before the
// request leaves the browser, so the policy would never see it. This flag
// turns off that separate check. It does not change any Fetch Metadata
// behavior, and the browser still sends the real `Sec-Fetch-*` headers.
test.use({
  launchOptions: {
    args: [
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks",
    ],
  },
});

const crossSitePage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Cross-site page</title></head>
  <body><h1>Cross-site page</h1></body>
</html>`;

test("a same-origin fetch reaches a guarded route and declares Vary", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url);

    return {
      body: await response.json(),
      status: response.status,
      vary: response.headers.get("vary"),
    };
  }, guardedUrl);

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ guarded: true, site: "same-origin" });
  // A shared cache must key on the field that produced this decision.
  expect(result.vary).toBe("Sec-Fetch-Site");
});

test("a same-site subresource request is denied", async ({ page }) => {
  await page.goto(sameSitePageUrl);
  // An opaque `no-cors` response hides its status from page script, so the
  // test reads the real status and headers from the browser network event.
  const guarded = page.waitForResponse(guardedUrl);
  await page.evaluate(
    async (url) => await fetch(url, { mode: "no-cors" }),
    guardedUrl,
  );
  const response = await guarded;

  expect(response.status()).toBe(403);
  expect(response.headers()["vary"]).toBe("Sec-Fetch-Site, Sec-Fetch-Mode");
});

test("a cross-site subresource request is denied", async ({ page }) => {
  await serveCrossSitePage(page);
  await page.goto(crossSitePageUrl);
  // An opaque `no-cors` response hides its status from page script, so the
  // test reads the real status and headers from the browser network event.
  const guarded = page.waitForResponse(guardedUrl);
  await page.evaluate(
    async (url) => await fetch(url, { mode: "no-cors" }),
    guardedUrl,
  );
  const response = await guarded;

  expect(response.status()).toBe(403);
  expect(response.headers()["vary"]).toBe("Sec-Fetch-Site, Sec-Fetch-Mode");
});

test("a cross-site top-level navigation still enters the site", async ({
  page,
}) => {
  await serveCrossSitePage(page);
  await page.goto(crossSitePageUrl);
  await page.evaluate((url) => {
    const link = document.createElement("a");
    link.href = url;
    link.id = "enter-the-site";
    link.textContent = "Enter the site";
    document.body.append(link);
  }, guardedUrl);

  const navigation = page.waitForResponse(guardedUrl);
  await page.click("#enter-the-site");
  const response = await navigation;

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ guarded: true, site: "cross-site" });
  // A navigation decision reads three fields, so all three reach `Vary`.
  expect(response.headers()["vary"]).toBe(
    "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest",
  );
});

test("an exempt route still serves another site through CORS", async ({
  page,
}) => {
  await serveCrossSitePage(page);
  await page.goto(crossSitePageUrl);
  // `Vary` is not a CORS-safelisted response header, so page script cannot
  // read it. A shared cache does read it, and so does this network event.
  const exempt = page.waitForResponse(openUrl);
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url);

    return {
      body: await response.json(),
      status: response.status,
    };
  }, openUrl);
  const response = await exempt;

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ open: true, site: "cross-site" });
  expect(response.headers()["vary"]).toBe("Sec-Fetch-Site");
});

test("a route without the policy keeps its pass-through behavior", async ({
  page,
}) => {
  await serveCrossSitePage(page);
  await page.goto(crossSitePageUrl);
  const unguardedUrl = "http://localhost:42177/api/request-metadata";
  const unguarded = page.waitForResponse(unguardedUrl);
  await page.evaluate(
    async (url) => await fetch(url, { mode: "no-cors" }),
    unguardedUrl,
  );
  const response = await unguarded;

  expect(response.status()).toBe(200);
  expect(response.headers()["vary"]).toBeUndefined();
});

async function serveCrossSitePage(page: Page) {
  await page.route(crossSitePageUrl, async (route) => {
    await route.fulfill({
      body: crossSitePage,
      contentType: "text/html; charset=utf-8",
      status: 200,
    });
  });
}
