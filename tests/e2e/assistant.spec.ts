import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "가상 계정 A로 시작", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:consent|dashboard)/);
  if (new URL(page.url()).pathname === "/consent") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "동의하고 시작하기", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("assistant API protects authentication, origin, consent and unavailable configuration", async ({ request }) => {
  expect((await request.get("/api/assistant")).status()).toBe(401);
  const origin = "http://127.0.0.1:3100";
  await request.post("/api/login", { data: { demoAccount: "b" }, headers: { Origin: origin } });
  const status = await request.get("/api/assistant");
  expect(status.headers()["cache-control"]).toContain("no-store");
  expect((await status.json()).available).toBe(false);
  expect((await request.post("/api/assistant", { headers: { Origin: "https://unrelated.example" }, data: { question: "당화혈색소" } })).status()).toBe(403);
  const noConsent = await request.post("/api/assistant", { headers: { Origin: origin }, data: { question: "당화혈색소" } });
  expect((await noConsent.json()).code).toBe("AI_CONSENT_REQUIRED");
  const disabled = await request.post("/api/assistant", { headers: { Origin: origin }, data: { question: "당화혈색소", allow_model_processing: true } });
  expect(disabled.status()).toBe(503);
});

test("chat sends only after acknowledgement and renders the answer and source on narrow screens", async ({ page }, info) => {
  await login(page);
  let submitted: unknown;
  await page.route("**/api/assistant", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { available: true, draftPreview: true, message: "일반 건강정보를 질문할 수 있어요." } });
    } else {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { kind: "answer", answer: "검사에 관한 일반적인 설명입니다.", draftPreview: true,
        citations: [{ id: "B01:KDCA_DIABETES", title: "당뇨병", publisher: "질병관리청", url: "https://health.kdca.go.kr/", pdfPages: [9] }] } });
    }
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "이어드림 도우미", exact: true });
  await panel.getByLabel("질문", { exact: true }).fill("당화혈색소가 무엇인가요?");
  const send = panel.getByRole("button", { name: "질문 전송", exact: true });
  await expect(send).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await send.click();
  await expect(panel.getByText("검사에 관한 일반적인 설명입니다.", { exact: true })).toBeVisible();
  await expect(panel.getByText("검사에 관한 일반적인 설명입니다.", { exact: true })).toBeInViewport();
  await expect(panel.getByRole("link", { name: "질병관리청 · 당뇨병", exact: true })).toHaveAttribute("href", "https://health.kdca.go.kr/");
  expect(submitted).toEqual({ question: "당화혈색소가 무엇인가요?", allow_model_processing: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("assistant-answer-360.png"), fullPage: true });
  await panel.getByRole("button", { name: "도우미 닫기", exact: true }).click();
  await expect(page.getByRole("button", { name: "도우미 열기", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(panel.getByLabel("질문", { exact: true })).toHaveValue("");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(panel.getByRole("region", { name: "도우미 답변" })).toHaveCount(0);
});

test("network failures show a readable error while preserving the question for retry", async ({ page }) => {
  await login(page);
  await page.route("**/api/assistant", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { available: true, draftPreview: true, message: "일반 건강정보" } });
    } else await route.abort("failed");
  });
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "이어드림 도우미", exact: true });
  await panel.getByLabel("질문", { exact: true }).fill("당화혈색소");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "질문 전송", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("연결이 끊어졌거나");
  await expect(panel.getByLabel("질문", { exact: true })).toHaveValue("당화혈색소");
  await expect(panel.getByRole("button", { name: "질문 전송", exact: true })).toBeEnabled();
});

test("closing an in-flight question clears it and a late answer cannot reappear", async ({ page }) => {
  await login(page);
  let release: () => void = () => undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/assistant", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { available: true, draftPreview: true, message: "일반 건강정보" } });
    } else {
      await hold;
      await route.fulfill({ json: { kind: "answer", answer: "표시되면 안 되는 이전 답변", citations: [], draftPreview: true } }).catch(() => undefined);
    }
  });
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "이어드림 도우미", exact: true });
  await panel.getByLabel("질문", { exact: true }).fill("당화혈색소");
  await panel.getByRole("checkbox").check();
  const sent = page.waitForRequest(request => request.url().endsWith("/api/assistant") && request.method() === "POST");
  await panel.getByRole("button", { name: "질문 전송", exact: true }).click();
  await sent;
  await panel.getByRole("button", { name: "도우미 닫기", exact: true }).click();
  release();
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(panel.getByText("표시되면 안 되는 이전 답변", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("질문", { exact: true })).toHaveValue("");
});
