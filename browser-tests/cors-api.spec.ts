import { expect, test } from "./fixtures";

const clientOrigin = "http://localhost:42183";

test("a real cross-origin GET reads the wildcard CORS response", async ({
  page,
}) => {
  const response = await page.goto(clientOrigin);

  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("greeting-result")).toHaveText(
    JSON.stringify({ message: "hello from a different origin" }),
  );
});

test("a real preflight lets a credentialed cross-origin POST through", async ({
  page,
}) => {
  await page.goto(clientOrigin);

  await expect(page.getByTestId("echo-result")).toHaveText(
    JSON.stringify({
      echoed: { message: "hello from a different origin" },
      receivedToken: "browser-secret",
    }),
  );
  // The response only exposes this header to page script because the policy
  // lists it under exposeHeaders. A missing entry would leave this null.
  await expect(page.getByTestId("echo-response-token")).toHaveText(
    "browser-secret",
  );
});
