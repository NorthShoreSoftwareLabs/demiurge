import { expect, test } from "./fixtures";

const origin = "http://localhost:42186";

test("the TanStack client validates, maps server errors, and revalidates", async ({
  page,
}) => {
  await page.goto(origin);

  const email = page.getByLabel("Email");
  const message = page.getByLabel("Message");
  const submit = page.getByRole("button", { name: "Save feedback" });

  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/feedback")) requests.push(request.method());
  });
  await submit.click();
  await expect(
    page.getByLabel("Email").locator("xpath=..").getByText(
      "Enter a valid email address.",
    ).first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Message").locator("xpath=..").getByText(
      "Use at least 10 characters.",
    ).first(),
  ).toBeVisible();
  expect(requests).toEqual([]);

  await email.fill("invalid");
  await expect(
    page.getByLabel("Email").locator("xpath=..").getByText(
      "Enter a valid email address.",
    ).first(),
  ).toBeVisible();
  await message.fill("short");
  await expect(
    page.getByLabel("Message").locator("xpath=..").getByText(
      "Use at least 10 characters.",
    ).first(),
  ).toBeVisible();

  await email.fill("person@example.com");
  await message.fill("A blocked message");
  await submit.click();
  await expect(page.getByText("This message is blocked by the server.")).toBeVisible();
  await expect(page.getByTestId("submission-count")).toContainText("0");

  await page.reload();
  const freshEmail = page.getByLabel("Email");
  const freshMessage = page.getByLabel("Message");
  await freshEmail.fill("person@example.com");
  await freshMessage.fill("A valid enhanced message");
  const startedAt = Date.now();
  await page.locator("form").evaluate((form) => form.requestSubmit());
  await expect(page).toHaveURL(`${origin}/?saved=1`);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  await expect(page.getByTestId("submission-count")).toContainText("1");
  await expect(page.getByTestId("latest-feedback")).toContainText("A valid enhanced message");
});
