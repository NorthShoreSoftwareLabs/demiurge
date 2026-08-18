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
  webServer: [
    {
      command: "pnpm --filter @demiurge-examples/node-server start",
      env: {
        HOST: "localhost",
        NODE_ENV: "production",
        PORT: "42177",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:42177/",
    },
    {
      command:
        "pnpm --filter @demiurge-examples/static-export preview --host localhost --port 42178",
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:42178/",
    },
    {
      command:
        "pnpm --filter @demiurge-examples/ssr-page dev --host localhost --port 42179",
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:42179/",
    },
    {
      command: "pnpm --filter @demiurge-examples/sse-feed start",
      env: {
        HOST: "localhost",
        NODE_ENV: "production",
        PORT: "42180",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:42180/",
    },
    {
      command: "pnpm --filter @demiurge-examples/conditional-script start",
      env: {
        HOST: "localhost",
        NODE_ENV: "production",
        PORT: "42181",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:42181/",
    },
  ],
});
