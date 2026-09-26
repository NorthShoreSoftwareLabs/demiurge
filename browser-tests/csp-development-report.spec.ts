import { expect, test } from "@playwright/test";

const developmentOrigin = "http://localhost:42179";
const reportPath = "/_demiurge/csp-report";

test("development collects a report for an early blocked resource", async ({
  page,
}) => {
  const reportRequestPromise = page.waitForRequest((request) =>
    request.url() === `${developmentOrigin}${reportPath}` &&
    request.method() === "POST"
  );

  const navigation = await page.goto(`${developmentOrigin}/csp-report`);
  const policy = (await navigation?.allHeaders())?.["content-security-policy"];

  expect(navigation?.status()).toBe(200);
  expect(policy).toContain(`report-uri ${reportPath}`);

  const reportRequest = await reportRequestPromise;
  expect(reportRequest.headers()["content-type"]).toContain(
    "application/csp-report",
  );
  expect(reportRequest.postDataJSON()).toMatchObject({
    "csp-report": {
      "blocked-uri": expect.stringMatching(
        /^https:\/\/blocked\.example\.test(?:\/|$)/,
      ),
      "effective-directive": "script-src-elem",
    },
  });

  const reportResponse = await reportRequest.response();
  expect(reportResponse?.status()).toBe(204);
});
