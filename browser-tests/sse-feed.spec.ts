import { expect, test } from "./fixtures";

const origin = "http://localhost:42180";

test("a real EventSource receives ticks and reconnects across closed streams", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const response = await page.goto(origin);

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "Live SSE feed" }))
    .toBeVisible();

  const feed = page.getByTestId("feed");

  await expect.poll(
    async () => await feed.locator("li").count(),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(9);

  const ticks = await feed.locator("li").evaluateAll((items) =>
    items.map((item) => Number(item.getAttribute("data-tick")))
  );
  expect(ticks).toEqual(ticks.map((_, index) => index + 1));

  const connections = await page.getByTestId("connections")
    .getAttribute("data-connections");
  expect(Number(connections)).toBeGreaterThan(1);
  expect(pageErrors).toEqual([]);
});

test("the SSE response headers survive the production Node server", async ({
  page,
}) => {
  await page.goto(origin);

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/feed", {
      headers: { accept: "text/event-stream" },
    });

    return {
      body: await response.text(),
      headers: {
        cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        xAccelBuffering: response.headers.get("x-accel-buffering"),
      },
    };
  });

  expect(result.headers.contentType).toBe("text/event-stream; charset=utf-8");
  expect(result.headers.cacheControl).toBe("no-cache");
  expect(result.headers.xAccelBuffering).toBe("no");
  expect(result.body).toContain("event: tick");
  expect(result.body).toContain("retry: 200");
});
