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
        citations: [{ id: "B01:R1", title: "Managing Diabetes", publisher: "NIDDK", url: "https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes", pdfPages: [],
          section: "A1C 설명", reuseLabel: "NIDDK 교육 본문 이용정책", reuseUrl: "https://www.niddk.nih.gov/copyright",
          attribution: "NIDDK, Managing Diabetes.", adaptationNotice: "프로젝트의 한국어 요약이며 기관의 서비스 승인을 뜻하지 않습니다." }] } });
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
  await expect(panel.getByRole("link", { name: "NIDDK · Managing Diabetes", exact: true })).toHaveAttribute("href", "https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes");
  await expect(panel.getByText("— A1C 설명", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "NIDDK 교육 본문 이용정책", exact: true })).toHaveAttribute("href", "https://www.niddk.nih.gov/copyright");
  await expect(panel.getByText(/PDF .*쪽/)).toHaveCount(0);
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

test("article licence and notice clause credits remain visible at 360px", async ({ page }, info) => {
  await login(page);
  await page.route("**/api/assistant", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: { available: true, draftPreview: true, message: "일반 건강정보" } });
    else await route.fulfill({ json: { kind: "answer", answer: "식사와 영양표시에 관한 교육용 답변입니다.", draftPreview: true, citations: [
      { id: "N01:R3", title: "Ernährungsempfehlungen für Menschen mit Diabetes (Update 2026)", publisher: "Klammer 외", url: "https://link.springer.com/article/10.1007/s00508-025-02676-7", pdfPages: [], section: "4. 식품 기반 권고",
        reuseLabel: "CC BY 4.0", reuseUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: "Klammer C, Schindler K, Bugl R, et al. (2026).", adaptationNotice: "프로젝트가 한국어로 요약·재구성했습니다." },
      { id: "N03:R4", title: "식품등의 표시기준", publisher: "식품의약품안전처", url: "https://www.mfds.go.kr/brd/m_211/view.do?seq=14917", pdfPages: [], section: "별지 1, 1. 아. 3)다)",
        reuseLabel: "국가 고시 규범 본문", reuseUrl: "https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029423769", attribution: "식품의약품안전처, 제2025-60호." },
    ] } });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "이어드림 도우미", exact: true });
  await panel.getByLabel("질문", { exact: true }).fill("식사와 영양표시를 어떻게 살펴봐?");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "질문 전송", exact: true }).click();
  await expect(panel.getByRole("link", { name: "CC BY 4.0", exact: true })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  await expect(panel.getByText("Klammer C, Schindler K, Bugl R, et al. (2026).", { exact: true })).toBeVisible();
  await expect(panel.getByText("프로젝트가 한국어로 요약·재구성했습니다.", { exact: true })).toBeVisible();
  await expect(panel.getByText("— 별지 1, 1. 아. 3)다)", { exact: true })).toBeVisible();
  await expect(panel.getByText(/PDF .*쪽/)).toHaveCount(0);
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("replacement-credits-360.png"), fullPage: true });
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
