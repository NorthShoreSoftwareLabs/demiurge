import { expect, test } from "./fixtures";

const developmentOrigin = "http://localhost:42179";

test("a development route can import meta and read import.meta", async ({
  page,
}) => {
  const response = await page.goto(developmentOrigin);

  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-development-mode]"))
    .toHaveAttribute("data-development-mode", "true");
});
