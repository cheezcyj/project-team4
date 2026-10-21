import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { seoulDay } from "../../src/lib/domain";

const origin = "http://127.0.0.1:3100";
async function login(page: Page) {
  expect((await page.request.post("/api/login", { headers: { Origin: origin }, data: { demoAccount: "a" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/consent", { headers: { Origin: origin }, data: { agreed: true } })).ok()).toBeTruthy();
}
async function addRecord(page: Page, values: Record<string, unknown>) {
  const response = await page.request.post("/api/records", { headers: { Origin: origin }, data: { id: randomUUID(), glucose_mg_dl: 100, measured_at: `${seoulDay()}T08:00:00+09:00`, measurement_context: "after_meal", meal_slot: "breakfast", meal_memo: null, ...values } });
  expect(response.status()).toBe(201);
  return (await response.json()).record.id as string;
}

test("통합 일지와 달력은 혈당·식사를 함께 보여주고 비교는 같은 상황과 시간대만 사용한다", async ({ page }) => {
  await login(page);
  const marker = `통합 확인 ${randomUUID()}`;
  const today = seoulDay(), prior = seoulDay(new Date(Date.now() - 7 * 86_400_000));
  const ids: string[] = [];
  let mealId = "";
  try {
    ids.push(await addRecord(page, { glucose_mg_dl: 100, measured_at: `${today}T08:00:00+09:00`, meal_memo: marker }));
    ids.push(await addRecord(page, { glucose_mg_dl: 80, measured_at: `${prior}T08:00:00+09:00`, meal_memo: marker }));
    ids.push(await addRecord(page, { glucose_mg_dl: 999, meal_slot: "snack", meal_memo: marker }));
    ids.push(await addRecord(page, { glucose_mg_dl: 700, measured_at: `${prior}T08:00:00+09:00`, meal_slot: null, meal_memo: marker }));
    const mealResponse = await page.request.post("/api/meals", { headers: { Origin: origin }, data: { id: randomUUID(), meal_at: `${today}T09:00:00+09:00`, meal_type: "breakfast", memo: marker, items: [{ free_text: "통합 확인 식사" }] } });
    expect(mealResponse.status()).toBe(201); mealId = (await mealResponse.json()).meal.id;
    await page.goto(`/records?date=${today}`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "통합 확인 식사" })).toBeVisible();
    const rows = page.getByRole("row").filter({ hasText: marker });
    await expect(rows.first()).toContainText("통합 확인 식사");
    await page.getByRole("button", { name: "식사", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "100 mg/dL" })).toHaveCount(0);
    await page.getByRole("row").filter({ hasText: "통합 확인 식사" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/meals/${mealId}/edit$`));
    await page.goto("/calendar");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "통합 확인 식사" })).toBeVisible();
    const [, month, day] = today.split("-").map(Number);
    await expect(page.getByRole("button", { name: new RegExp(`${month}월 ${day}일, 혈당`) })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "이전 달", exact: true }).click();
    await expect(page.getByRole("button", { name: "오늘", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "오늘", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "통합 확인 식사" })).toBeVisible();
    await page.goto("/comparison");
    await page.getByLabel("측정 상황", { exact: true }).selectOption("after_meal");
    await page.getByLabel("식사 시간대", { exact: true }).selectOption("breakfast");
    await expect(page.getByText("최근 평균이 20 mg/dL 높게 기록됐어요.", { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(2);
    await expect(page.getByRole("row").filter({ hasText: "999" })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "700" })).toHaveCount(0);
    await page.getByLabel("식사 시간대", { exact: true }).selectOption("snack");
    await expect(page.getByText("한쪽 기간에 기록이 없어 비교할 수 없어요.", { exact: true })).toBeVisible();
    await page.goto("/reports");
    await page.getByLabel("조회 기간").selectOption("14");
    await expect(page.getByRole("img", { name: /최근 14일 혈당 선·점 그래프/ })).toBeVisible();
    await expect(page.locator(".recharts-scatter-line")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: marker })).toHaveCount(4);
  } finally {
    for (const id of ids) await page.request.delete(`/api/records/${id}`, { headers: { Origin: origin } });
    if (mealId) await page.request.delete(`/api/meals/${mealId}`, { headers: { Origin: origin } });
  }
});

test("CSV는 행 오류 때 저장을 막고 응답이 끊긴 저장을 같은 요청으로 확인한다", async ({ page }) => {
  await login(page);
  const marker = `CSV 확인 ${randomUUID()}`;
  const date = seoulDay();
  const csv = `\uFEFFmeasured_at,glucose_mg_dl,measurement_context,meal_slot,meal_memo\n${date} 10:00,125,식후,점심,${marker}\n${date} 12:00,155,식후 2시간,점심,${marker}`;
  try {
    await page.goto("/imports");
    await page.getByLabel(/UTF-8 CSV 파일/).setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(csv.replace(",155,", ",-1,"), "utf8") });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await expect(page.getByRole("button", { name: "전체 기록 저장", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "확인이 필요한 오류" })).toContainText("2행:");
    await page.getByRole("button", { name: "파일·열 연결 수정", exact: true }).click();
    await page.getByLabel(/UTF-8 CSV 파일/).setInputFiles({ name: "valid.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    let submissions = 0, requestId = "";
    await page.route("**/api/imports", async route => { if (route.request().method() !== "POST") return route.continue(); submissions++; requestId = route.request().postDataJSON().request_id; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("connectionfailed"); });
    await page.getByRole("button", { name: "전체 기록 저장", exact: true }).click();
    await expect(page.getByRole("button", { name: "저장 결과 확인", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "전체 기록 저장", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "저장 결과 확인", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("2건을 모두 저장했어요.");
    expect(submissions).toBe(1);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const records = (await (await page.request.get(`/api/records?date=${date}`)).json()).records;
    expect(records.filter((record: { meal_memo: string }) => record.meal_memo === marker)).toHaveLength(2);
    await page.unroute("**/api/imports");
    await page.getByRole("button", { name: "다른 파일 가져오기", exact: true }).click();
    await page.getByLabel(/UTF-8 CSV 파일/).setInputFiles({ name: "same.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await page.getByRole("button", { name: "전체 기록 저장", exact: true }).click();
    await expect(page.getByRole("heading", { name: "이미 가져온 내용이에요.", exact: true })).toBeVisible();
  } finally {
    const records = (await (await page.request.get(`/api/records?date=${date}`)).json()).records;
    for (const record of records.filter((record: { meal_memo: string }) => record.meal_memo === marker)) await page.request.delete(`/api/records/${record.id}`, { headers: { Origin: origin } });
  }
});

test("일지·달력·리포트·비교·가져오기는 작은 화면과 키보드 접근성을 유지한다", async ({ page }, info) => {
  test.setTimeout(90_000);
  await login(page);
  for (const path of ["/records", "/calendar", "/reports", "/comparison", "/imports"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /불러오는 중/ })).toHaveCount(0);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await info.attach(`${path.slice(1)}-accessibility`, { body: JSON.stringify(audit.violations), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
  }
});


test('CSV 템플릿을 내려받아 작성하면 한글 열이 자동 연결된다', async ({ page }) => {
  await login(page);
  await page.goto('/imports');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'CSV 템플릿 다운로드', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('이어드림_혈당기록_양식.csv');
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toBe('\uFEFF측정 시각,혈당,측정 상황,식사 시간대,식사 메모,혈당 단위\r\n');
  const filled = csv + `${seoulDay()} 08:30,120,공복,,,mg/dL\r\n`;
  await page.getByLabel(/UTF-8 CSV 파일/).setInputFiles({ name: '작성한_혈당기록.csv', mimeType: 'text/csv', buffer: Buffer.from(filled, 'utf8') });
  for (const [index, label] of ['측정 시각 (필수)', '혈당 (필수)', '측정 상황 (필수)', '식사 시간대 (선택)', '식사 메모 (선택)', '혈당 단위 (선택)'].entries()) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(index));
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '전체 기록 저장', exact: true })).toBeEnabled();
  await expect(page.getByRole('table')).toContainText('120');
  await expect(page.getByRole('table')).toContainText('확인됨');
});
