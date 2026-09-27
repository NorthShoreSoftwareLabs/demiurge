import { expect, test } from "@playwright/test";

const developmentOrigin = "http://localhost:42179";
const reportPath = "/_demiurge/csp-report";

test("development collects a report for an early blocked resource", async ({
  page,
}) => {
  const scriptReportPromise = page.waitForRequest((request) =>
    isReportForBlockedUri(request, /^https:\/\/blocked\.example\.test(?:\/|$)/)
  );
  const dataReportPromise = page.waitForRequest((request) =>
    isReportForBlockedUri(request, /^data$/)
  );

  const navigation = await page.goto(`${developmentOrigin}/csp-report`);
  const policy = (await navigation?.allHeaders())?.["content-security-policy"];

  expect(navigation?.status()).toBe(200);
  expect(policy).toContain(`report-uri ${reportPath}`);

  const scriptReport = await scriptReportPromise;
  expect(scriptReport.headers()["content-type"]).toContain(
    "application/csp-report",
  );
  expect(scriptReport.postDataJSON()).toMatchObject({
    "csp-report": {
      "blocked-uri": expect.stringMatching(
        /^https:\/\/blocked\.example\.test(?:\/|$)/,
      ),
      "effective-directive": "script-src-elem",
    },
  });

  const scriptResponse = await scriptReport.response();
  expect(scriptResponse?.status()).toBe(204);

  const dataReport = await dataReportPromise;
  expect(dataReport.headers()["content-type"]).toContain(
    "application/csp-report",
  );
  expect(dataReport.postDataJSON()).toMatchObject({
    "csp-report": {
      "blocked-uri": "data",
      "effective-directive": "script-src-elem",
    },
  });

  const dataResponse = await dataReport.response();
  expect(dataResponse?.status()).toBe(204);
});

function isReportForBlockedUri(
  request: import("@playwright/test").Request,
  blockedUri: RegExp,
) {
  if (
    request.url() !== `${developmentOrigin}${reportPath}` ||
    request.method() !== "POST"
  ) {
    return false;
  }

  const body = request.postDataJSON() as {
    "csp-report"?: { "blocked-uri"?: unknown };
  };
  const value = body["csp-report"]?.["blocked-uri"];
  return typeof value === "string" && blockedUri.test(value);
}
