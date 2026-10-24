import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// 계산 도구만 켜며 초안 자료·모델 답변은 사용하지 않는 별도 실제 API 시나리오예요.
export default defineConfig({ ...base, testIgnore: [], testMatch: "assistant-records.spec.ts", webServer: {
  ...base.webServer as object,
  command: "npm run start:demo", url: "http://127.0.0.1:3100/api/health", reuseExistingServer: false,
  env: { PORT: "3100", ASSISTANT_ENABLED: "1", ASSISTANT_ALLOW_DRAFT_PREVIEW: "0",
    DEMO_DATA_FILE: `.local/e2e/summary-${Date.now()}.json` }, timeout: 60_000,
} });
