import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { HealthProfile } from "../../src/lib/domain/health-profile";

const consentLabel = "입력한 개인정보를 저장하는 데 동의해요. (선택)";
const section = (page: Page) => page.getByRole("region", { name: "내 기본 정보", exact: true });
const headers = (info: TestInfo) => ({ Origin: String(info.project.use.baseURL) });
async function login(page: Page, info: TestInfo, account = "a") {
  expect((await page.request.post("/api/login", { headers: headers(info), data: { demoAccount: account } })).ok()).toBeTruthy();
  const session = await (await page.request.get("/api/session")).json();
  if (session.consent !== "current") expect((await page.request.post("/api/consent", { headers: headers(info), data: { agreed: true } })).ok()).toBeTruthy();
}
async function stored(page: Page) {
  const response = await page.request.get("/api/profile");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).profile as HealthProfile | null;
}
async function clearProfile(page: Page, info: TestInfo) {
  const profile = await stored(page);
  if (profile) expect((await page.request.delete("/api/profile", { headers: headers(info), data: { expected_updated_at: profile.updated_at } })).ok()).toBeTruthy();
}
async function enterProfile(page: Page) {
  await page.goto("/mypage");
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toBeVisible();
}
async function saveProfile(page: Page, age: string) {
  await page.getByLabel("나이 (선택)", { exact: true }).fill(age);
  await page.getByLabel(consentLabel, { exact: true }).check();
  await page.getByRole("button", { name: "개인정보 저장", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("개인정보를 저장했어요.");
}

test.beforeEach(async ({ page }, info) => {
  await login(page, info);
  await clearProfile(page, info);
});

test("선택 개인정보를 동의 후 저장·재조회·수정·삭제하고 다른 기록은 유지한다", async ({ page }, info) => {
  await enterProfile(page);
  await expect(page.getByLabel(consentLabel, { exact: true })).not.toBeChecked();
  await expect(section(page)).toContainText("지금은 도우미 답변에 사용하지 않아요.");
  await page.getByLabel("성별 (선택)", { exact: true }).selectOption("female");
  await page.getByLabel("키 (선택)", { exact: true }).fill("168.5");
  await page.getByLabel("몸무게 (선택)", { exact: true }).fill("62.1");
  await saveProfile(page, "31");
  const first = await stored(page);
  expect(first).toMatchObject({ sex: "female", age: 31, height_cm: 168.5, weight_kg: 62.1, notice_version: "health-profile-v1" });
  await expect(page.getByLabel(consentLabel, { exact: true })).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel("키 (선택)", { exact: true })).toHaveValue("168.5");
  await expect(page.getByLabel("몸무게 (선택)", { exact: true })).toHaveValue("62.1");
  await page.getByLabel("몸무게 (선택)", { exact: true }).fill("61.8");
  await saveProfile(page, "32");
  const updated = await stored(page);
  expect(updated).toMatchObject({ age: 32, weight_kg: 61.8, created_at: first?.created_at });
  expect(updated?.updated_at).not.toBe(first?.updated_at);
  const recordsBefore = await (await page.request.get("/api/records?days=7")).json();
  const preferencesBefore = await (await page.request.get("/api/preferences")).json();
  await page.getByRole("button", { name: "개인정보 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "개인정보를 삭제할까요?" });
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await expect(dialog).toContainText("계정과 혈당·식사 기록, 맞춤 조건은 남아요.");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(await stored(page)).toMatchObject({ age: 32 });
  await page.getByRole("button", { name: "개인정보 삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "개인정보 삭제", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("개인정보를 삭제했어요.");
  expect(await stored(page)).toBeNull();
  expect(await (await page.request.get("/api/records?days=7")).json()).toEqual(recordsBefore);
  expect(await (await page.request.get("/api/preferences")).json()).toEqual(preferencesBefore);
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "개인정보 삭제", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("profile-deleted.png"), fullPage: true });
});

test("범위·소수·동의 오류를 입력 옆에 표시하고 첫 오류에 초점을 둔다", async ({ page }) => {
  await enterProfile(page);
  await page.getByLabel("나이 (선택)", { exact: true }).fill("121");
  await page.getByLabel("키 (선택)", { exact: true }).fill("170.12");
  await page.getByLabel("몸무게 (선택)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "개인정보 저장", exact: true }).click();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toBeFocused();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(section(page)).toContainText("나이는 0~120 사이의 정수로 입력해 주세요.");
  await expect(section(page)).toContainText("키는 30~250cm 사이에서 소수 첫째 자리까지 입력해 주세요.");
  await expect(section(page)).toContainText("몸무게는 1~500kg 사이에서 소수 첫째 자리까지 입력해 주세요.");
  await page.getByLabel("나이 (선택)", { exact: true }).fill("35");
  await page.getByLabel("키 (선택)", { exact: true }).fill("");
  await page.getByLabel("몸무게 (선택)", { exact: true }).fill("");
  await page.getByRole("button", { name: "개인정보 저장", exact: true }).click();
  await expect(page.getByLabel(consentLabel, { exact: true })).toBeFocused();
  expect(await stored(page)).toBeNull();
  await saveProfile(page, "35");
  expect(await stored(page)).toMatchObject({ sex: null, age: 35, height_cm: null, weight_kg: null });
});

test("다른 화면의 수정과 충돌하면 내 입력을 보존하고 최신 정보 확인 뒤 다시 저장한다", async ({ page }, info) => {
  await enterProfile(page);
  await saveProfile(page, "30");
  const before = await stored(page);
  await page.getByLabel("나이 (선택)", { exact: true }).fill("32");
  await page.getByLabel(consentLabel, { exact: true }).check();
  expect((await page.request.put("/api/profile", { headers: headers(info), data: { sex: null, age: 31, height_cm: null, weight_kg: null, allow_storage: true, notice_version: "health-profile-v1", expected_updated_at: before!.updated_at } })).ok()).toBeTruthy();
  await page.getByRole("button", { name: "개인정보 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장된 정보 확인", exact: true })).toBeVisible();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("32");
  await expect(page.getByRole("button", { name: "개인정보 저장", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "저장된 정보 확인", exact: true }).click();
  await expect(section(page)).toContainText("31세");
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("32");
  await page.getByRole("button", { name: "개인정보 저장", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("개인정보를 저장했어요.");
  expect(await stored(page)).toMatchObject({ age: 32 });
});

test("저장·삭제 응답이 끊기면 중복 처리 없이 서버 결과를 조회한다", async ({ page }) => {
  await enterProfile(page);
  const writes = { PUT: 0, DELETE: 0 };
  await page.route("**/api/profile", async route => {
    const method = route.request().method();
    if (method !== "PUT" && method !== "DELETE") return route.continue();
    writes[method] += 1;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort("failed");
  });
  await page.getByLabel("나이 (선택)", { exact: true }).fill("40");
  await page.getByLabel(consentLabel, { exact: true }).check();
  await section(page).locator("form").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("button", { name: "저장된 정보 확인", exact: true })).toBeVisible();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("40");
  await expect(page.getByRole("button", { name: "개인정보 저장", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "저장된 정보 확인", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("개인정보가 저장된 것을 확인했어요.");
  expect(writes.PUT).toBe(1);
  expect(await stored(page)).toMatchObject({ age: 40 });
  await page.getByRole("button", { name: "개인정보 삭제", exact: true }).click();
  await page.getByRole("dialog", { name: "개인정보를 삭제할까요?" }).getByRole("button", { name: "개인정보 삭제", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장된 정보 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "저장된 정보 확인", exact: true }).click();
  await expect(section(page).getByRole("status")).toHaveText("개인정보가 삭제된 것을 확인했어요.");
  expect(writes.DELETE).toBe(1);
  expect(await stored(page)).toBeNull();
});

test("미저장 이동 경고·키보드 선택·좁은 화면과 접근성을 유지한다", async ({ page }, info) => {
  await enterProfile(page);
  const sex = page.getByLabel("성별 (선택)", { exact: true });
  await sex.focus();
  await sex.press("ArrowDown");
  await sex.press("Enter");
  await expect(sex).toHaveValue("female");
  await page.getByRole("link", { name: "내 기록 확인·삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "저장하지 않고 이동할까요?" });
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(sex).toHaveValue("female");
  await saveProfile(page, "27");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("profile-desktop.png"), fullPage: true });
  for (const width of [768, 360]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("profile-mobile.png"), fullPage: true });
  await page.getByLabel("나이 (선택)", { exact: true }).fill("28");
  await page.getByRole("link", { name: "CSV 파일 가져오기", exact: true }).click();
  await dialog.getByRole("button", { name: "저장하지 않고 이동", exact: true }).click();
  await expect(page).toHaveURL(/\/imports$/);
  await enterProfile(page);
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("27");
});

test("개인정보 조회 실패와 로딩을 구분하고 다시 불러온다", async ({ page }) => {
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/profile", async route => {
    await paused;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "개인정보를 불러오지 못했어요.", code: "DATA_UNAVAILABLE" }) });
  }, { times: 1 });
  await page.goto("/mypage");
  await expect(section(page).getByRole("status")).toContainText("개인정보를 불러오는 중이에요.");
  await expect(page.getByRole("button", { name: "개인정보 저장", exact: true })).toHaveCount(0);
  release();
  await expect(section(page).getByRole("alert")).toContainText("개인정보를 불러오지 못했어요.");
  await section(page).getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("");
});

test("계정이 바뀌면 이전 계정의 미저장 개인정보를 보여주지 않는다", async ({ page }, info) => {
  await login(page, info, "b");
  await clearProfile(page, info);
  await login(page, info, "a");
  await enterProfile(page);
  await page.getByLabel("나이 (선택)", { exact: true }).fill("46");
  await page.getByLabel(consentLabel, { exact: true }).check();
  await login(page, info, "b");
  await page.evaluate(() => {
    const channel = new BroadcastChannel("glucose-session");
    channel.postMessage({ sender: "profile-test", type: "changed" });
    channel.close();
  });
  await expect(page.getByRole("link", { name: "가상 계정 B 마이페이지", exact: true })).toBeVisible();
  await expect(page.getByLabel("나이 (선택)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel(consentLabel, { exact: true })).not.toBeChecked();
  expect(await stored(page)).toBeNull();
});
