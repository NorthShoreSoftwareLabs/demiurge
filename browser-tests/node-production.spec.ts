import { expect, test } from "@playwright/test";

test("production SSR hydrates and navigates without a document reload", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  const routeDataRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-navigation"] === "data") {
      routeDataRequests.push(request.url());
    }
  });

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "SSR is running" })).toBeVisible();
  await page.getByRole("link", { name: "Browse items" }).click();
  await expect(page).toHaveURL("http://localhost:42177/items");
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  await page.getByRole("link", { name: "alpha" }).click();
  await expect(page).toHaveURL("http://localhost:42177/items/alpha");
  await expect(page.getByRole("heading", { name: "Item: alpha" })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "SSR is running" })).toBeVisible();
  await expect(page.locator("[data-rendered-by=node]")).toBeVisible();

  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType("navigation").length,
  );
  expect(navigationCount).toBe(1);
  expect(routeDataRequests).toContain("http://localhost:42177/");
  expect(pageErrors).toEqual([]);
});

test("strict CSP and browser security headers are enforced", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"];

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cache-control"]).toBe("private, no-store");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("upgrade-insecure-requests");
  expect(csp).not.toContain("'unsafe-inline'");

  await page.evaluate(() => {
    const image = document.createElement("img");
    image.setAttribute(
      "onerror",
      "window.__demiurgeInlineHandlerRan = true",
    );
    image.src = "/missing-csp-probe.png";
    document.body.append(image);
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __demiurgeInlineHandlerRan?: boolean })
            .__demiurgeInlineHandlerRan,
      ),
    )
    .toBeUndefined();
});

test("production renders an app-owned 404 document", async ({ page }) => {
  const response = await page.goto("/missing-browser-route");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "No route at /missing-browser-route" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Demiurge Node Server");
});

test("the Node adapter preserves repeated secure cookie headers", async ({
  context,
  page,
}) => {
  const result = await page.goto("/api/cookies");

  expect(result?.status()).toBe(200);
  const cookies = await context.cookies("http://localhost:42177/");
  const session = cookies.find((cookie) => cookie.name === "__Host-session");
  const preference = cookies.find(
    (cookie) => cookie.name === "__Host-preference",
  );

  expect(session).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "alpha",
  });
  expect(preference).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Strict",
    secure: true,
    value: "beta",
  });
});

test("browser-generated Fetch Metadata reaches route handlers", async ({ page }) => {
  await page.goto("/");
  const metadata = await page.evaluate(async () => {
    const response = await fetch("/api/request-metadata");
    return (await response.json()) as Record<string, string | null>;
  });

  expect(metadata).toMatchObject({
    destination: "empty",
    mode: "cors",
    site: "same-origin",
  });
});

test("issued CSRF tokens complete the browser cookie and header flow", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const issuedResponse = await fetch("/api/csrf");
    const issued = (await issuedResponse.json()) as { token: string };
    const rejected = await fetch("/api/csrf-submit", {
      body: JSON.stringify({ message: "hello" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const accepted = await fetch("/api/csrf-submit", {
      body: JSON.stringify({ message: "hello" }),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": issued.token,
      },
      method: "POST",
    });

    return {
      acceptedBody: await accepted.json(),
      acceptedStatus: accepted.status,
      cookie: document.cookie,
      rejectedStatus: rejected.status,
      token: issued.token,
    };
  });

  expect(result.rejectedStatus).toBe(403);
  expect(result.acceptedStatus).toBe(200);
  expect(result.acceptedBody).toEqual({
    accepted: true,
    body: { message: "hello" },
  });
  expect(result.cookie).toContain(`csrf-token=${result.token}`);
});
