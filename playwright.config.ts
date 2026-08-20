import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? "github" : "line",
  retries: process.env.CI ? 2 : 0,
  testDir: "browser-tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:42177",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // Playwright boots the entries of a `webServer` array one at a time, costing
  // about a second per server before the first test runs. The eight servers
  // these tests need have distinct ports and no shared state.
  // `tooling/browser-test-servers.ts` starts them all at once, then opens
  // port 42176 once every one of them answers.
  webServer: {
    command: "tsx tooling/browser-test-servers.ts",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:42176/",
  },
});
