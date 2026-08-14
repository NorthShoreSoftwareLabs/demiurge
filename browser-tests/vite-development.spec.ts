import { expect, test } from "./fixtures";

const developmentOrigin = "http://localhost:42179";

test("Vite development hydrates and applies the app stylesheet", async ({
  page,
}) => {
  const failedRequests: string[] = [];
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  const response = await page.goto(developmentOrigin);

  expect(response?.status()).toBe(200);
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
});

test("the Vite development not-found document hydrates", async ({ page }) => {
  const failedRequests: string[] = [];
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  const response = await page.goto(`${developmentOrigin}/missing-browser-route`);

  expect(response?.status()).toBe(404);
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
});
