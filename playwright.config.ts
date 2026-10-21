import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: ".local/playwright-results",
  reporter: [["list"], ["html", { outputFolder: ".local/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "npm run start:demo",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      DEMO_DATA_FILE: `.local/e2e/demo-${Date.now()}.json`
    },
    timeout: 60_000
  }
});
