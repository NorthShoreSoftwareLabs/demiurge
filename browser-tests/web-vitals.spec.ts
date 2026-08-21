import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const origin = "http://localhost:42185";

type CollectedReport = {
  id: string;
  name: string;
  navigationType: string;
  rating: string;
  url: string;
  value: number;
};

test("the web vitals collector reports through a beacon under a strict CSP", async ({
  page,
  request,
}) => {
  const response = await page.goto(origin, { waitUntil: "domcontentloaded" });
  const policy = await response?.headerValue("content-security-policy") ?? "";

  expect(response?.status()).toBe(200);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain("'unsafe-inline'");

  // The collector starts after hydration, because it runs inside the
  // application bundle rather than in a script tag of its own.
  await expect(page.getByTestId("hydrated-marker")).toHaveText("Hydrated.");

  // A navigation away from the page fires `pagehide`, which is the moment the
  // collector flushes. The `cspMonitor` fixture fails this test on any policy
  // violation that the beacon causes.
  await page.goto(`${origin}/api/timings`, { waitUntil: "domcontentloaded" });

  // Only `POST /api/vitals` stores a report, so a non-empty list proves the
  // beacon reached the endpoint through the effective connect-src directive.
  const metrics = await readReports(request);
  const names = metrics.map((metric) => metric.name);

  expect(names).toContain("TTFB");
  expect(names).toContain("FCP");
  expect(names).toContain("CLS");

  for (const metric of metrics) {
    expect(metric.url).toBe(`${origin}/`);
    expect(metric.navigationType).toBe("navigate");
    expect(["good", "needs-improvement", "poor"]).toContain(metric.rating);
    expect(metric.value).toBeGreaterThanOrEqual(0);
    expect(metric.id.length).toBeGreaterThan(0);
  }
});

// `navigator.sendBeacon` returns before the request reaches the server, so the
// endpoint is polled until it holds the reports.
async function readReports(request: APIRequestContext) {
  let metrics: CollectedReport[] = [];

  await expect(async () => {
    const response = await request.get(`${origin}/api/vitals`);
    const body = (await response.json()) as { metrics: CollectedReport[] };

    metrics = body.metrics;
    expect(metrics.length).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });

  return metrics;
}
