import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const origin = "http://localhost:42181";
const analyticsSrc = "/vendor/analytics";

// The afterInteractive tag on the strategies route holds the main thread for
// this long, starting while the browser still parses the document.
const mainThreadBusyMs = 1_200;

async function readTiming(page: Page, testId: string) {
  const text = await page.getByTestId(testId).textContent();

  return Number(text);
}

test("the home route never requests the analytics script", async ({ page }) => {
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(analyticsSrc)) {
      analyticsRequests.push(request.url());
    }
  });

  const response = await page.goto(origin);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Conditional script example" }))
    .toBeVisible();
  await page.waitForTimeout(600);

  expect(analyticsRequests).toEqual([]);
  expect(await page.locator('script[src="/vendor/analytics"]').count())
    .toBe(0);
});

test("the dashboard route skips the script without consent", async ({ page }) => {
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(analyticsSrc)) {
      analyticsRequests.push(request.url());
    }
  });

  await page.goto(`${origin}/dashboard`);

  await expect(page.getByTestId("consent-status")).toHaveText(
    "Consent not granted.",
  );
  await page.waitForTimeout(600);

  expect(analyticsRequests).toEqual([]);
  expect(await page.getByTestId("analytics-marker").count()).toBe(0);
});

test("the dashboard route loads the script after consent without blocking hydration", async ({
  page,
}) => {
  const response = await page.goto(`${origin}/dashboard?consent=granted`, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(200);
  expect(await response?.headerValue("content-security-policy")).toContain(
    "'strict-dynamic'",
  );

  await expect(page.getByTestId("consent-status")).toHaveText(
    "Consent granted.",
  );

  // Hydration finishes, and the marker text updates, before the
  // artificially slow analytics script has had time to arrive.
  await expect(page.getByTestId("hydrated-marker")).toHaveText("Hydrated.");
  expect(await page.getByTestId("analytics-marker").count()).toBe(0);

  await expect(page.getByTestId("analytics-marker")).toBeAttached({
    timeout: 5_000,
  });

  const analyticsScript = page.locator('script[src="/vendor/analytics"]');
  await expect(analyticsScript).toHaveAttribute("async", "");

  // SAFETY: The locator matches a script tag, so the element is an HTMLScriptElement.
  const analyticsNonce = await analyticsScript.evaluate(
    (element) => (element as HTMLScriptElement).nonce,
  );
  expect(analyticsNonce.length).toBeGreaterThan(0);
});

test("the strategies route ships idle and worker scripts as inert placeholders", async ({
  page,
}) => {
  const response = await page.request.get(`${origin}/strategies`);
  const html = await response.text();

  expect(html).toContain('type="text/demiurge-script" nonce=');
  expect(html).toContain('data-demiurge-script="idle"');
  expect(html).toContain('data-demiurge-script-src="/vendor/idle-tag"');
  expect(html).toContain('data-demiurge-script="worker"');
  expect(html).toContain('data-demiurge-script-src="/vendor/worker-task"');

  // Nothing in the document can make the browser fetch either source while it
  // parses, because neither placeholder carries a src attribute.
  expect(html).not.toContain('<script id="idle-tag" src=');
  expect(html).not.toContain('<script id="worker-task" src=');
  expect(html).toContain('<script id="eager-tag" src="/vendor/eager-tag"');
  expect(response.headers()["content-security-policy"]).toContain(
    "worker-src 'self'",
  );
});

test("the idle strategy waits for the browser to go idle", async ({ page }) => {
  const requestedAt = new Map<string, number>();
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());

    if (!requestedAt.has(pathname)) {
      requestedAt.set(pathname, Date.now());
    }
  });

  await page.goto(`${origin}/strategies`);
  await expect(page.getByTestId("idle-loaded-at")).not.toBeEmpty({
    timeout: 15_000,
  });

  const busyEndedAt = await readTiming(page, "busy-ended-at");
  const eagerLoadedAt = await readTiming(page, "eager-loaded-at");
  const hydratedAt = await readTiming(page, "hydrated-at");
  const idleLoadedAt = await readTiming(page, "idle-loaded-at");

  // The afterInteractive tag runs before hydration, and before the busy main
  // thread work it starts. The idle tag has to wait for that work to let go of
  // the main thread, so it lands far later.
  expect(eagerLoadedAt).toBeLessThan(hydratedAt);
  expect(eagerLoadedAt).toBeLessThan(busyEndedAt);
  expect(idleLoadedAt - eagerLoadedAt).toBeGreaterThan(mainThreadBusyMs / 2);

  // The idle tag never blocks hydration. React hydrates between the busy
  // tasks, well before the idle tag arrives.
  expect(hydratedAt).toBeLessThan(idleLoadedAt);

  // The network layer carries the same story. The afterInteractive request
  // goes out while the browser parses the document. The idle request waits for
  // the busy main thread to go quiet.
  const eagerRequestedAt = requestedAt.get("/vendor/eager-tag") ?? 0;
  const idleRequestedAt = requestedAt.get("/vendor/idle-tag") ?? 0;

  expect(eagerRequestedAt).toBeGreaterThan(0);
  expect(idleRequestedAt - eagerRequestedAt)
    .toBeGreaterThan(mainThreadBusyMs / 2);

  // The loaded script arrives in the head, and it carries the identifier the
  // route declared for it.
  await expect(page.locator('head script[src="/vendor/idle-tag"]'))
    .toHaveAttribute("id", "idle-tag");
});

test("the worker strategy runs its script off the main thread", async ({
  page,
}) => {
  await page.goto(`${origin}/strategies`);
  await expect(page.getByTestId("worker-finished-at")).not.toBeEmpty({
    timeout: 15_000,
  });

  const mainThreadResumedAt = await readTiming(page, "main-thread-resumed-at");
  const workerFinishedAt = await readTiming(page, "worker-finished-at");
  const workerStartedAt = await readTiming(page, "worker-started-at");

  // The worker blocks its own thread for 600ms. The main thread ran a task
  // while that block was in progress, which a main thread script could never
  // allow.
  expect(workerFinishedAt - workerStartedAt).toBeGreaterThanOrEqual(500);
  expect(workerFinishedAt - mainThreadResumedAt).toBeGreaterThan(400);

  // The worker source never becomes a document script.
  expect(await page.locator('script[src="/vendor/worker-task"]').count())
    .toBe(0);
});
