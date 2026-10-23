import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { recentRange, seoulDay } from "../../src/lib/domain";

const origin = "http://127.0.0.1:3100";
const endpoint = "/api/assistant/records-summary";
const recordLabel = "이번 요약을 위해 본인의 최근 7일 공복 기록 조회에 동의합니다.";
const headers = { Origin: origin };
async function apiLogin(request: APIRequestContext, account = "a") {
  expect((await request.post("/api/login", { data: { demoAccount: account }, headers })).status()).toBe(200);
}
async function agree(request: APIRequestContext) {
  expect((await request.post("/api/consent", { data: { agreed: true }, headers })).status()).toBe(200);
}
async function login(page: Page) {
  await apiLogin(page.request); await agree(page.request); await page.goto("/dashboard");
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: recordLabel, exact: true })).toBeVisible();
}
async function add(request: APIRequestContext, value: number, measured_at: string, measurement_context = "fasting") {
  const id = randomUUID();
  const response = await request.post("/api/records", { headers, data: { id, glucose_mg_dl: value, measured_at,
    measurement_context, meal_memo: "PRIVATE_SYNTHETIC_MEMO" } });
  expect(response.status()).toBe(201);
  return id;
}

test("real summary API enforces authentication, same origin, service consent, explicit record consent and strict scope", async ({ request }) => {
  expect((await request.post(endpoint, { headers, data: { allow_record_access: true } })).status()).toBe(401);
  await apiLogin(request, "b");
  let response = await request.post(endpoint, { headers, data: { allow_record_access: true } });
  expect((await response.json()).code).toBe("RECORD_CONSENT_REQUIRED");
  await agree(request);
  response = await request.post(endpoint, { headers, data: {} });
  expect((await response.json()).code).toBe("RECORD_ACCESS_CONSENT_REQUIRED");
  response = await request.post(endpoint, { headers: { Origin: "https://unrelated.example" }, data: { allow_record_access: true } });
  expect((await response.json()).code).toBe("ORIGIN_MISMATCH");
  response = await request.post(endpoint, { headers, data: { allow_record_access: true, user_id: "other" } });
  expect((await response.json()).code).toBe("INVALID_INPUT");
  response = await request.post(endpoint, { headers, data: { allow_record_access: true } });
  expect(response.headers()["cache-control"]).toContain("no-store");
  const empty = await response.json();
  expect(empty.kind).toBe("record_summary"); expect(empty.recordSummary.average).toBeNull();
  expect(empty.recordSummary.count).toBe(0); expect(empty.recordSummary.missingDays).toBe(7);
  expect(empty.answer).toContain("계산하지 않았어요");
  await add(request, 903, new Date(Date.now() - 60_000).toISOString());
});

test("real storage and screen show only own fasting measurements, exact statistics and record provenance without a model", async ({ page }, info) => {
  await apiLogin(page.request); await agree(page.request);
  // This server has a fresh synthetic test file. Remove only that fixture's A records.
  const range = recentRange();
  const rows = await (await page.request.get(`/api/records?start=${seoulDay(range.start)}&end=${seoulDay()}`)).json();
  for (const row of rows.records) expect((await page.request.delete(`/api/records/${row.id}`, { headers })).status()).toBe(200);
  await add(page.request, 110, range.start);
  await add(page.request, 111, new Date(Date.now() - 60_000).toISOString());
  await add(page.request, 900, new Date(Date.now() - 60_000).toISOString(), "before_meal");
  await add(page.request, 901, new Date(Date.now() + 3_600_000).toISOString());
  await add(page.request, 902, new Date(Date.parse(range.start) - 1).toISOString());
  const response = await page.request.post(endpoint, { headers, data: { allow_record_access: true } });
  const result = await response.json();
  expect(result.recordSummary).toMatchObject({ count: 2, average: 110.5, min: 110, max: 111, recordedDays: 2, missingDays: 5 });
  expect(result.citations).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC_MEMO|user_id|demo-a|903/);
  await page.goto("/dashboard"); await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  const send = page.getByRole("button", { name: "공복 기록 요약", exact: true });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox", { name: recordLabel, exact: true }).check(); await send.click();
  const answer = page.getByRole("region", { name: "도우미 답변" });
  await expect(answer).toContainText("평균 110.5");
  await expect(answer).toContainText("출처: 본인 혈당 기록");
  await expect(answer).toContainText("기록은 AI에 전송하지 않았어요");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("fasting-summary-360.png"), fullPage: true });
  await page.getByRole("checkbox", { name: recordLabel, exact: true }).uncheck();
  await expect(answer).toHaveCount(0); await expect(send).toBeDisabled();
});

test("withdrawing record permission aborts a pending request and discards a late result", async ({ page }) => {
  await login(page);
  let release: () => void = () => undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${endpoint}`, async route => {
    await wait;
    await route.fulfill({ json: { kind: "record_summary", answer: "LATE_PRIVATE_RESULT", citations: [], draftPreview: false } }).catch(() => undefined);
  });
  const check = page.getByRole("checkbox", { name: recordLabel, exact: true });
  await check.check();
  const sent = page.waitForRequest(r => r.url().endsWith(endpoint));
  await page.getByRole("button", { name: "공복 기록 요약", exact: true }).click(); await sent;
  await expect(check).toBeEnabled(); await check.uncheck(); release();
  await expect(page.getByRole("region", { name: "도우미 답변" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "공복 기록 요약", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "도우미 닫기", exact: true }).click();
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(check).not.toBeChecked(); await expect(page.getByText("LATE_PRIVATE_RESULT", { exact: true })).toHaveCount(0);
});

test("a record change in another tab invalidates the displayed summary and clears permission", async ({ page, context }) => {
  await login(page);
  await page.getByRole("checkbox", { name: recordLabel, exact: true }).check();
  await page.getByRole("button", { name: "공복 기록 요약", exact: true }).click();
  await expect(page.getByRole("region", { name: "도우미 답변" })).toBeVisible();
  const other = await context.newPage(); await other.goto("/records/new");
  await other.getByLabel("혈당값", { exact: false }).fill("112");
  await other.getByRole("radio", { name: "공복", exact: true }).check();
  await other.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(other).toHaveURL(/\/records\?date=/);
  await expect(page.getByRole("dialog", { name: "이어드림 도우미", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: recordLabel, exact: true })).not.toBeChecked();
  await expect(page.getByRole("region", { name: "도우미 답변" })).toHaveCount(0);
});

test("logout in another tab removes a personal summary and record permission", async ({ page, context }) => {
  await login(page);
  await page.getByRole("checkbox", { name: recordLabel, exact: true }).check();
  await page.getByRole("button", { name: "공복 기록 요약", exact: true }).click();
  await expect(page.getByRole("region", { name: "도우미 답변" })).toBeVisible();
  const other = await context.newPage(); await other.goto("/dashboard");
  await other.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(page.getByRole("region", { name: "도우미 답변" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: recordLabel, exact: true })).toHaveCount(0);
});

test("editing, reclassifying and deleting records invalidate summaries and recompute exact results", async ({ page, context }, info) => {
  test.setTimeout(60_000);
  await apiLogin(page.request); await agree(page.request);
  // The configuration starts a new synthetic file, so only this fixture's A records are removed.
  const range = recentRange();
  const rows = await (await page.request.get(`/api/records?start=${seoulDay(range.start)}&end=${seoulDay()}`)).json();
  for (const row of rows.records) expect((await page.request.delete(`/api/records/${row.id}`, { headers })).status()).toBe(200);
  const measuredAt = new Date(Date.now() - 60_000).toISOString();
  const first = await add(page.request, 110, measuredAt);
  const second = await add(page.request, 130, measuredAt);
  await page.goto("/dashboard"); await page.setViewportSize({ width: 360, height: 800 });
  const panel = page.getByRole("dialog", { name: "이어드림 도우미", exact: true });
  const answer = page.getByRole("region", { name: "도우미 답변" });
  const evidence: unknown[] = [];
  async function refresh(step: string, expected: { count: number; average: number | null; min: number | null; max: number | null }) {
    await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
    const permission = page.getByRole("checkbox", { name: recordLabel, exact: true });
    await expect(permission).not.toBeChecked();
    await expect(answer).toHaveCount(0);
    await permission.check();
    const received = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name: "공복 기록 요약", exact: true }).click();
    const response = await received;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.recordSummary).toMatchObject(expected);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SYNTHETIC_MEMO");
    await expect(answer).toContainText(expected.average === null ? "계산하지 않았어요" : `평균 ${expected.average}`);
    evidence.push({ step, expected, actual: result.recordSummary });
  }
  async function invalidated() {
    await expect(panel).not.toBeVisible();
    await expect(answer).toHaveCount(0);
  }
  const other = await context.newPage();
  const journal = await context.newPage(); await journal.goto("/records");
  const journalRegion = journal.getByRole("region", { name: "통합 일지", exact: true });
  const dashboardRows = page.getByRole("table", { name: /그래프와 같은 최근 7일 기록/ }).locator("tbody tr");
  await refresh("initial", { count: 2, average: 120, min: 110, max: 130 });
  await other.goto(`/records/${second}/edit`);
  await other.getByLabel("혈당값", { exact: false }).fill("140");
  await other.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(other).toHaveURL(/\/records\?date=/);
  await invalidated();
  await expect(dashboardRows.filter({ hasText: /140\s*mg\/dL/ })).toHaveCount(1);
  await expect(dashboardRows.filter({ hasText: /130\s*mg\/dL/ })).toHaveCount(0);
  await expect(journalRegion.getByRole("row").filter({ hasText: /140\s*mg\/dL/ })).toHaveCount(1);
  await refresh("value edited", { count: 2, average: 125, min: 110, max: 140 });
  await page.screenshot({ path: info.outputPath("summary-after-edit-360.png"), fullPage: true });
  await other.goto(`/records/${second}/edit`);
  await other.getByRole("radio", { name: "식전", exact: true }).check();
  await other.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(other).toHaveURL(/\/records\?date=/);
  await invalidated();
  await expect(dashboardRows.filter({ hasText: /140\s*mg\/dL/ })).toContainText("식전");
  await expect(journalRegion.getByRole("row").filter({ hasText: /140\s*mg\/dL/ })).toContainText("식전");
  await refresh("reclassified as before_meal", { count: 1, average: 110, min: 110, max: 110 });
  for (const [id, step, expected] of [
    [second, "non-fasting record deleted", { count: 1, average: 110, min: 110, max: 110 }],
    [first, "last fasting record deleted", { count: 0, average: null, min: null, max: null }],
  ] as const) {
    await other.goto(`/records/${id}/edit`);
    await other.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await other.getByRole("dialog", { name: "이 기록을 삭제할까요?", exact: true })
      .getByRole("button", { name: "기록 삭제", exact: true }).click();
    await expect(other).toHaveURL(/\/records\?date=/);
    await invalidated();
    await expect(dashboardRows.filter({ hasText: /140\s*mg\/dL/ })).toHaveCount(0);
    await expect(journalRegion.getByRole("row").filter({ hasText: /140\s*mg\/dL/ })).toHaveCount(0);
    await refresh(step, expected);
  }
  await expect(page.getByRole("heading", { name: "최근 7일에 남긴 기록이 없어요.", exact: true })).toBeVisible();
  await expect(answer).toContainText("미기록일을 혈당 0으로 처리하지 않아요");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("summary-after-final-delete-360.png"), fullPage: true });
  const evidencePath = info.outputPath("summary-mutations.json");
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  await info.attach("summary-mutations.json", { path: evidencePath, contentType: "application/json" });
});
