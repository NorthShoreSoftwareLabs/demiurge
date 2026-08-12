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
  webServer: {
    command:
      "pnpm --filter demiurge build && pnpm --filter @demiurge-examples/node-server build && pnpm --filter @demiurge-examples/node-server start",
    env: {
      HOST: "localhost",
      NODE_ENV: "production",
      PORT: "42177",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:42177/",
  },
});
