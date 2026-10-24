import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { FoodCatalogItem, MealRecord } from "../../src/lib/domain/service-types";

async function login(page: Page, info: TestInfo) {
  const origin = String(info.project.use.baseURL);
  expect((await page.request.post("/api/login", { headers: { Origin: origin }, data: { demoAccount: "a" } })).ok()).toBeTruthy();
  const session = await (await page.request.get("/api/session")).json();
  if (session.consent !== "current") expect((await page.request.post("/api/consent", { headers: { Origin: origin }, data: { agreed: true } })).ok()).toBeTruthy();
}
async function findMeal(page: Page, memo: string) {
  const response = await page.request.get("/api/meals?days=7");
  expect(response.ok()).toBeTruthy();
  const { meals } = await response.json() as { meals: MealRecord[] };
  const matches = meals.filter(meal => meal.memo === memo);
  expect(matches).toHaveLength(1);
  return matches[0];
}
test.beforeEach(async ({ page }, info) => { await login(page, info); });

test("공통 음식 50,002개에서 무작위 100개를 표시하고 검색에는 제외 규칙을 유지한다", async ({ page }) => {
  const first = await (await page.request.get("/api/foods")).json();
  const second = await (await page.request.get("/api/foods")).json();
  for (const result of [first, second]) {
    expect(result.matched_count).toBe(50002);
    expect(result.randomized).toBe(true);
    expect(result.foods).toHaveLength(100);
    expect(new Set(result.foods.map((food: FoodCatalogItem) => food.id)).size).toBe(100);
    expect(result.foods.every((food: FoodCatalogItem) => !/^\s*[?？]/u.test(food.food_name))).toBe(true);
  }
  expect(first.foods.map((food: FoodCatalogItem) => food.id)).not.toEqual(second.foods.map((food: FoodCatalogItem) => food.id));
  const search = await (await page.request.get(`/api/foods?q=${encodeURIComponent("가래떡")}`)).json();
  expect(search.randomized).toBe(false);
  expect(search.foods.every((food: FoodCatalogItem) => food.food_name.includes("가래떡"))).toBe(true);
  await page.goto("/meals/new");
  await expect(page.getByRole("status").filter({ hasText: "등록된 음식" })).toContainText("50,002개 중 무작위로 고른 100개");
  await expect(page.getByRole("list", { name: "음식 검색 결과" }).getByRole("listitem")).toHaveCount(100);
});

test("식사 메모만 저장하고 재조회·삭제할 수 있다", async ({ page }, info) => {
  const memo = `식사 단독 검사 ${randomUUID()}`;
  await page.goto("/meals/new");
  await page.getByLabel("식사 메모 (선택)").fill(memo);
  await page.getByRole("radio", { name: "점심", exact: true }).check();
  await page.getByRole("button", { name: "식사 기록 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const stored = await findMeal(page, memo);
  expect(stored.items).toHaveLength(0); expect(stored.meal_type).toBe("lunch");
  await page.goto(`/meals/${stored.id}/edit`);
  await expect(page.getByLabel("식사 메모 (선택)")).toHaveValue(memo);
  await page.getByRole("button", { name: "식사 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("식사와 연결된 음식 항목을 영구 삭제해요.");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect((await page.request.get(`/api/meals/${stored.id}`)).ok()).toBeTruthy();
  await page.getByRole("button", { name: "식사 삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "식사 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  expect((await page.request.get(`/api/meals/${stored.id}`)).status()).toBe(404);
  await page.screenshot({ path: info.outputPath("meal-delete-result.png"), fullPage: true });
});

test("한국어 부분 검색과 식사 편집에서 원본 영양값·단위와 새 음식 추가를 보존한다", async ({ page }, info) => {
  const memo = `음식 단위 검사 ${randomUUID()}`;
  const catalog = await (await page.request.get("/api/foods?q=김치")).json() as { foods: FoodCatalogItem[]; matched_count?: number; total?: number };
  expect(catalog.foods.length).toBeGreaterThan(0);
  const selectedFood = catalog.foods[0];
  await page.goto("/meals/new");
  await page.getByLabel("음식 이름", { exact: true }).fill("김치");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "‘김치’ 검색 결과" })).toContainText(`${(catalog.matched_count ?? catalog.total ?? catalog.foods.length).toLocaleString("ko-KR")}개`);
  await page.locator("section[aria-labelledby='food-heading']").getByRole("listitem").first().getByRole("button").click();
  await page.getByLabel("섭취량 (선택)").fill("50");
  await page.getByRole("combobox", { name: "단위", exact: true }).selectOption("ml");
  await expect(page.getByText(selectedFood.unit_validated ? "기준 단위와 달라 섭취량을 환산하지 않았어요. g과 ml는 자동 변환하지 않아요." : "원본 기준 단위 검증 전이라 섭취량을 환산하지 않았어요.")).toBeVisible();
  await page.getByRole("button", { name: "검색어 지우기", exact: true }).click();
  await expect(page.getByLabel("음식 이름", { exact: true })).toHaveValue("");
  await page.getByLabel("식사 메모 (선택)").fill(memo);
  await page.getByRole("button", { name: "식사 기록 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const first = await findMeal(page, memo);
  expect(first.items[0].conversion_state).toBe("unavailable");
  expect(first.items[0].nutrition_snapshot?.basis_unit).toBe(selectedFood.basis_unit);
  expect(first.items[0].nutrition_snapshot?.nutrients.kcal).toBe(selectedFood.kcal);
  const originalSnapshot = first.items[0].nutrition_snapshot;
  await page.goto(`/meals/${first.id}/edit`);
  await page.getByRole("combobox", { name: "단위", exact: true }).selectOption("g");
  await page.getByLabel("음식 이름", { exact: true }).fill("두부");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "‘두부’ 검색 결과" })).toBeVisible();
  await page.locator("section[aria-labelledby='food-heading']").getByRole("listitem").first().getByRole("button").click();
  await page.getByRole("button", { name: "식사 수정 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const edited = (await (await page.request.get(`/api/meals/${first.id}`)).json()).meal as MealRecord;
  expect(edited.items).toHaveLength(2);
  expect(edited.items.find(item => item.id === first.items[0].id)?.nutrition_snapshot).toEqual(originalSnapshot);
  const expectedConversion = selectedFood.unit_validated && selectedFood.basis_unit === "g" ? "verified" : "unavailable";
  expect(edited.items.find(item => item.id === first.items[0].id)?.conversion_state).toBe(expectedConversion);
  await page.goto(`/meals/${first.id}/edit`);
  const mealPanel = page.locator("section[aria-labelledby='meal-heading']");
  await mealPanel.locator("summary").first().click();
  const expectedKcal = selectedFood.kcal === null ? "정보 없음" : `${Number((selectedFood.kcal * (expectedConversion === "verified" ? 50 / selectedFood.basis_value : 1)).toFixed(2)).toLocaleString("ko-KR")} kcal`;
  await expect(mealPanel.getByText(expectedKcal, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("meal-food-readback.png"), fullPage: true });
  await page.request.delete(`/api/meals/${first.id}`, { headers: { Origin: String(info.project.use.baseURL) } });
});

test("섭취량 단위 오류와 직접입력 정보 없음, 모바일 접근성을 확인한다", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/meals/new");
  await page.getByLabel("음식 이름 직접 입력", { exact: true }).fill("집에서 만든 음식");
  await page.getByRole("button", { name: "직접 입력한 음식 추가", exact: true }).click();
  const mealPanel = page.locator("section[aria-labelledby='meal-heading']");
  await expect(mealPanel.getByText("영양정보 없음", { exact: true })).toBeVisible();
  await page.getByLabel("섭취량 (선택)").fill("-2");
  await page.getByRole("combobox", { name: "단위", exact: true }).selectOption("g");
  await page.getByRole("button", { name: "식사 기록 저장", exact: true }).click();
  await expect(page.getByText("섭취량은 0보다 크고 1억 미만인 숫자, 소수점 4자리까지 입력해 주세요.")).toBeVisible();
  await expect(page).toHaveURL(/\/meals\/new$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include("section[aria-labelledby='food-heading']").include("section[aria-labelledby='meal-heading']").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("meal-mobile-validation.png"), fullPage: true });
});

test("식사 저장 응답이 끊겨도 재전송 없이 저장 결과를 확인한다", async ({ page }, info) => {
  const memo = `식사 응답 확인 ${randomUUID()}`;
  let writes = 0;
  await page.route("**/api/meals", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    writes += 1;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort("failed");
  });
  await page.goto("/meals/new");
  await page.getByLabel("식사 메모 (선택)").fill(memo);
  await page.getByRole("button", { name: "식사 기록 저장", exact: true }).click();
  await expect(page.getByText("저장 결과를 확인하지 못했어요. 다시 저장하기 전에 결과를 확인해 주세요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "식사 기록 저장", exact: true })).toBeDisabled();
  await expect(page.getByLabel("식사 메모 (선택)")).toHaveValue(memo);
  await page.getByRole("button", { name: "저장·삭제 결과 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  expect(writes).toBe(1);
  const saved = await findMeal(page, memo);
  await page.request.delete(`/api/meals/${saved.id}`, { headers: { Origin: String(info.project.use.baseURL) } });
});

test("맞춤 조건은 명시적으로 저장·삭제하고 정책 근거와 뉴스 빈 상태를 표시한다", async ({ page }, info) => {
  const origin = String(info.project.use.baseURL);
  await page.request.delete("/api/preferences", { headers: { Origin: origin } });
  await page.goto("/preferences");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByLabel("거주 지역 (선택)").selectOption("경기");
  await page.getByLabel("연령대 (선택)").selectOption("19_39");
  await page.getByLabel("당뇨병 진단 여부 (선택)").selectOption("true");
  await page.getByLabel("인슐린 사용 여부 (선택)").selectOption("true");
  expect((await (await page.request.get("/api/preferences")).json()).preferences).toBeNull();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "맞춤 조건 저장", exact: true }).click();
  await expect(page.getByText("맞춤 조건을 저장했어요.", { exact: true })).toBeVisible();
  const saved = (await (await page.request.get("/api/preferences")).json()).preferences;
  expect(saved.region).toBe("경기"); expect(saved.matching_enabled).toBe(true); expect(saved.consented_at).toBeTruthy();
  await page.goto("/benefits");
  await expect(page.getByRole("heading", { name: "당뇨병환자 소모성재료 구입비", exact: true })).toBeVisible();
  await expect(page.getByText("추가 확인 필요", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /지원 대상·신청 방법 확인/ }).first()).toHaveAttribute("href", /^https:\/\//);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("benefits-mobile.png"), fullPage: true });
  await page.goto("/preferences");
  await page.getByRole("button", { name: "맞춤 조건 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "맞춤 조건 삭제", exact: true }).click();
  await expect(page.getByText("맞춤 조건을 삭제했어요. 개인 조건을 이용한 선별도 중지했어요.")).toBeVisible();
  expect((await (await page.request.get("/api/preferences")).json()).preferences).toBeNull();
  let newsRequests = 0;
  await page.route("**/api/news", route => route.fulfill({ json: { articles: [], configured: true, provider: "mohw", source_url: "https://www.mohw.go.kr/rss/board.es", refresh: { status: "fresh", last_success_at: "2026-10-24T00:00:00Z", error: null, automatic: true } } }));
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/news") newsRequests += 1; });
  await page.goto("/news");
  const news = page.getByRole("region", { name: "건강 뉴스 목록" });
  await expect(news.getByRole("heading", { name: "아직 등록된 소식이 없어요." })).toBeVisible();
  await expect(news.getByRole("link")).toHaveCount(0);
  expect(newsRequests).toBeGreaterThan(0);
});

test('식사 메모는 이모지도 한 문자로 세고 500자 저장과 501자 오류를 구분한다', async ({ page }) => {
  await page.goto('/meals/new');
  const memo=page.getByLabel('식사 메모 (선택)');
  await memo.fill('🍎'.repeat(501));
  await page.getByRole('button',{name:'식사 기록 저장',exact:true}).click();
  await expect(memo).toBeFocused();
  await expect(memo).toHaveAttribute('aria-invalid','true');
  await expect(page.getByText('메모는 500자까지 입력해 주세요.',{exact:true})).toBeVisible();
  await memo.fill('🍎'.repeat(500));
  await expect(memo).toHaveValue('🍎'.repeat(500));
  await expect(page.getByText('500 / 500자',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'식사 기록 저장',exact:true}).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const stored=await findMeal(page,'🍎'.repeat(500));
  expect([...stored.memo!]).toHaveLength(500);
});
