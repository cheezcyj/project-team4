import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { isoToSeoulInput, seoulDay } from "../../src/lib/domain";

async function login(page: Page, account: "A" | "B" = "A") {
  await page.goto("/login");
  await page.getByRole("button", { name: `가상 계정 ${account}로 시작` }).click();
  await expect(page).toHaveURL(/\/(?:dashboard|consent)(?:[/?]|$)/);
  if (new URL(page.url()).pathname === "/consent") {
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByRole("button", { name: "동의하고 시작하기" })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "동의하고 시작하기" }).click();
  }
  await expect(page.getByRole("heading", { name: "혈당 한눈에", exact: true })).toBeVisible();
}

async function fillRecord(page: Page, memo: string, time = new Date().toISOString()) {
  await page.getByLabel("혈당값", { exact: false }).fill("117");
  await page.getByLabel("측정 시각", { exact: false }).fill(isoToSeoulInput(time));
  await page.getByRole("radio", { name: "공복", exact: true }).check();
  await page.getByLabel("식사 메모", { exact: false }).fill(memo);
}

async function audit(page: Page, info: TestInfo, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await info.attach(`accessibility-${label}`, {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  expect(result.violations, `${label} accessibility violations`).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(size.documentWidth).toBeLessThanOrEqual(size.viewportWidth + 1);
}

test("actual UI creates, validates, moves to a past date, and deletes with focus-safe confirmation", async ({ page }, info) => {
  const memo = `UI 생성 ${randomUUID()}`;
  await login(page);
  await page.getByRole("link", { name: "혈당 기록하기", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "혈당 기록하기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page.getByLabel("혈당값", { exact: false })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("측정 시점을 선택해 주세요.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("혈당값", { exact: false })).toBeFocused();
  await fillRecord(page, memo);
  await page.getByLabel("식사 메모", { exact: false }).fill("🍎".repeat(501));
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page.getByText("메모는 500자까지 입력할 수 있어요.", { exact: true })).toBeVisible();
  await page.getByLabel("식사 메모", { exact: false }).fill(memo);
  await audit(page, info, "create-form");
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("status").filter({ hasText: "저장했어요." })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: memo });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: /기록 보기$/ }).click();
  await expect(page.getByRole("heading", { name: "기록 상세·수정", exact: true })).toBeVisible();
  const recordUrl = page.url();
  const id = new URL(recordUrl).pathname.split("/")[2];
  const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
  await page.getByLabel("혈당값", { exact: false }).fill("129");
  await page.getByLabel("측정 시각", { exact: false }).fill(isoToSeoulInput(past));
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/records\\?date=${seoulDay(past)}$`));
  await expect(page.getByRole("row").filter({ hasText: memo })).toContainText("129");
  const recent = await page.request.get("/api/records");
  expect(recent.ok()).toBeTruthy();
  expect((await recent.json()).records.some((record: { id: string }) => record.id === id)).toBeFalsy();
  await page.getByRole("row").filter({ hasText: memo }).getByRole("link", { name: /기록 보기$/ }).click();
  const deleteTrigger = page.getByRole("button", { name: "기록 삭제", exact: true });
  await deleteTrigger.click();
  const dialog = page.getByRole("dialog", { name: "이 기록을 삭제할까요?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("129 mg/dL");
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await audit(page, info, "delete-dialog");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "기록 삭제", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(deleteTrigger).toBeFocused();
  await expect(page.getByLabel("혈당값", { exact: false })).toHaveValue("129");
  await deleteTrigger.click();
  await dialog.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/records\\?date=${seoulDay(past)}$`));
  await expect(page.getByRole("status").filter({ hasText: "기록을 삭제했어요." })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: memo })).toHaveCount(0);
  expect((await page.request.get(`/api/records/${id}`)).status()).toBe(404);
});

test("a committed save with a lost response verifies the same UUID without resubmitting", async ({ page }) => {
  const memo = `응답 확인 ${randomUUID()}`;
  await login(page);
  await page.goto("/records/new");
  await fillRecord(page, memo);
  let submissions = 0;
  let savedId = "";
  let serverStatus = 0;
  await page.route(/\/api\/records$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions += 1;
    savedId = route.request().postDataJSON().id;
    const response = await route.fetch();
    serverStatus = response.status();
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장 결과 확인", exact: true })).toBeVisible();
  expect(serverStatus).toBe(201);
  expect(submissions).toBe(1);
  expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "기록 저장", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "저장 결과 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("row").filter({ hasText: memo })).toBeVisible();
  expect(submissions).toBe(1);
  const response = await page.request.get(`/api/records/${savedId}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).record.meal_memo).toBe(memo);
});

test("a committed delete with a lost response checks absence before reporting success", async ({ page }) => {
  const memo = `삭제 응답 확인 ${randomUUID()}`;
  await login(page);
  await page.goto("/records/new");
  await fillRecord(page, memo);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await page.getByRole("row").filter({ hasText: memo }).getByRole("link", { name: /기록 보기$/ }).click();
  await expect(page.getByRole("heading", { name: "기록 상세·수정", exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2];
  let deletes = 0;
  let serverStatus = 0;
  await page.route(`**/api/records/${id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes += 1;
    const response = await route.fetch();
    serverStatus = response.status();
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page.getByRole("dialog", { name: "이 기록을 삭제할까요?" })
    .getByRole("button", { name: "기록 삭제", exact: true }).click();
  await expect(page.getByRole("button", { name: "삭제 결과 확인", exact: true })).toBeVisible();
  expect(serverStatus).toBe(200);
  await page.getByRole("button", { name: "삭제 결과 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("status").filter({ hasText: "기록을 삭제했어요." })).toBeVisible();
  expect(deletes).toBe(1);
  expect((await page.request.get(`/api/records/${id}`)).status()).toBe(404);
});

test("failed list loading shows a recoverable error rather than an empty or incomplete record list", async ({ page }) => {
  await login(page);
  await page.route(/\/api\/records(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "기록 연결을 확인해 주세요.", code: "DATA_UNAVAILABLE" }),
    });
  });
  await page.goto("/records");
  await expect(page.getByRole("heading", { name: "불러오지 못했어요", exact: true })).toBeVisible();
  await expect(page.getByText("선택한 기간에 기록이 없어요.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.unroute(/\/api\/records(?:\?.*)?$/);
  await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("heading", { name: "불러오지 못했어요", exact: true })).toHaveCount(0);
});

test("login, dashboard, records, consent, and form fit 360/768/1280px and expose accessible content", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "가상 계정 A로 시작", exact: true })).toBeVisible();
  await audit(page, info, "login");
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await noHorizontalOverflow(page);
  }
  await login(page);
  await expect(page.getByRole("img", { name: /최근 7일 혈당 그래프/ })).toBeVisible();
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: true });
  }
  await audit(page, info, "dashboard");
  for (const path of ["/records", "/consent", "/records/new"]) {
    await page.goto(path);
    if (path === "/records") await expect(page.getByRole("table")).toBeVisible();
    if (path === "/consent") await expect(page.getByRole("heading", { name: "이용 전 확인해 주세요", exact: true })).toBeVisible();
    if (path === "/records/new") await expect(page.getByLabel("혈당값", { exact: false })).toBeEnabled();
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await noHorizontalOverflow(page);
    }
    await audit(page, info, path.replaceAll("/", "-"));
  }
});

test("switching accounts clears unsaved values and never shows the previous account's records", async ({ page }) => {
  const draft = `계정 A 임시 메모 ${randomUUID()}`;
  await login(page, "A");
  await page.goto("/records/new");
  await fillRecord(page, draft);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "작성한 내용을 지울까요?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "내용 지우고 이동", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "가상 계정 B로 시작", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:dashboard|consent)(?:[/?]|$)/);
  if (new URL(page.url()).pathname === "/consent") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "동의하고 시작하기", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "혈당 한눈에", exact: true })).toBeVisible();
  const response = await page.request.get("/api/records");
  expect(response.status()).toBe(200);
  expect((await response.json()).records.every((record: { user_id: string }) => record.user_id === "22222222-2222-4222-8222-222222222222")).toBeTruthy();
  await page.goto("/records/new");
  await expect(page.getByLabel("혈당값", { exact: false })).toHaveValue("");
  await expect(page.getByLabel("식사 메모", { exact: false })).toHaveValue("");
  await expect(page.getByText(draft, { exact: true })).toHaveCount(0);
});
