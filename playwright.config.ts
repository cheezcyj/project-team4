import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "assistant-records.spec.ts",
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
    ...devices["Desktop Chrome"],
    ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
  },
  webServer: {
    command: "npm run start:demo",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      ASSISTANT_ENABLED: "0",
      ASSISTANT_ALLOW_DRAFT_PREVIEW: "0",
      DEMO_DATA_FILE: `.local/e2e/demo-${Date.now()}.json`
    },
    timeout: 60_000
  }
});
