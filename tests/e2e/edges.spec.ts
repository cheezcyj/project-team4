import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { isoToSeoulInput, seoulDay } from "../../src/lib/domain";

async function startDemo(page: Page, account: "A" | "B" = "A") {
  await page.goto("/login");
  await page.getByRole("button", { name: `가상 계정 ${account}로 시작`, exact: true }).click();
  await expect(page).toHaveURL(/\/(?:dashboard|consent)(?:[/?]|$)/);
  if (new URL(page.url()).pathname === "/consent") {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "동의하고 시작하기", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "혈당 한눈에", exact: true })).toBeVisible();
}

async function assertWidth(page: Page) {
  const widths = await page.evaluate(() => ({
    rendered: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.rendered).toBeLessThanOrEqual(widths.viewport + 1);
}

test("maximum integer and 500 Korean characters remain usable at 360px in list, edit, and graph", async ({ page }, info) => {
  await startDemo(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/records/new");
  await page.getByLabel("혈당값", { exact: false }).fill("2147483647");
  await page.getByLabel("측정 시각", { exact: false }).fill(isoToSeoulInput());
  await page.getByRole("radio", { name: "기타", exact: true }).check();
  await page.getByLabel("식사 메모", { exact: false }).fill("가".repeat(500));
  await expect(page.getByText("500 / 500자", { exact: true })).toBeVisible();
  await assertWidth(page);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=\d{4}-\d{2}-\d{2}$/);
  const row = page.getByRole("row").filter({ hasText: "가".repeat(500) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2,147,483,647");
  await assertWidth(page);
  await page.screenshot({ path: info.outputPath("maximum-record-list-360.png"), fullPage: true });
  await row.getByRole("link", { name: /기록 보기$/ }).click();
  await expect(page.getByRole("heading", { name: "기록 상세·수정", exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2];
  try {
    await expect(page.getByLabel("혈당값", { exact: false })).toHaveValue("2147483647");
    await expect(page.getByLabel("식사 메모", { exact: false })).toHaveValue("가".repeat(500));
    await assertWidth(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("img", { name: /최근 7일 혈당 그래프/ })).toBeVisible();
    const yTicks = page.getByRole("img", { name: /최근 7일 혈당 그래프/ })
      .locator("text").filter({ hasText: /^(?:0|[\d.]+억)$/ });
    await expect(yTicks.first()).toBeVisible();
    const labelsFit = await yTicks.evaluateAll(labels => labels.every(label => {
      const rect = label.getBoundingClientRect();
      const chart = label.closest("svg")!.getBoundingClientRect();
      return rect.left >= chart.left && rect.right <= chart.right;
    }));
    expect(labelsFit, "Y축 숫자가 그래프 경계에서 잘리지 않아야 합니다.").toBe(true);
    await assertWidth(page);
    await page.screenshot({ path: info.outputPath("maximum-value-dashboard-360.png"), fullPage: true });
  } finally {
    const origin = new URL(page.url()).origin;
    const response = await page.request.delete(`/api/records/${id}`, { headers: { Origin: origin } });
    expect(response.status()).toBe(200);
  }
});

test("logout and account change in another tab masks the first tab and reloads the new owner only", async ({ page, context }) => {
  await startDemo(page, "A");
  await expect(page.getByText("가상 계정 A", { exact: true })).toBeVisible();
  const firstRecords = await page.request.get("/api/records");
  expect(firstRecords.ok()).toBeTruthy();
  const firstIds = (await firstRecords.json()).records.map((record: { id: string }) => record.id);
  const other = await context.newPage();
  try {
    await other.goto("/dashboard");
    await expect(other.getByText("가상 계정 A", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(other).toHaveURL(/\/login$/);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /최근 7일 혈당 그래프/ })).toHaveCount(0);
    await expect(page.getByText("가상 계정 A", { exact: true })).toHaveCount(0);
    await startDemo(other, "B");
    await page.goto("/dashboard");
    await expect(page.getByText("가상 계정 B", { exact: true })).toBeVisible();
    await expect(page.getByText("가상 계정 A", { exact: true })).toHaveCount(0);
    const response = await page.request.get("/api/records");
    expect(response.ok()).toBeTruthy();
    const records = (await response.json()).records as { id: string; user_id: string }[];
    expect(records.every((record) => record.user_id === "22222222-2222-4222-8222-222222222222")).toBeTruthy();
    expect(records.some((record) => firstIds.includes(record.id))).toBeFalsy();
  } finally {
    await other.close();
  }
});

test("success notices require an actual mutation and disappear after reloading", async ({ page }) => {
  await startDemo(page);
  await page.goto(`/records?date=${seoulDay()}&saved=1&deleted=1`);
  await expect(page.getByRole("heading", { name: "기록 목록", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요." })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "기록을 삭제했어요." })).toHaveCount(0);
  await page.goto("/records/new");
  const memo = `일회성 안내 ${randomUUID()}`;
  await page.getByLabel("혈당값", { exact: false }).fill("118");
  await page.getByLabel("측정 시각", { exact: false }).fill(isoToSeoulInput());
  await page.getByRole("radio", { name: "공복", exact: true }).check();
  await page.getByLabel("식사 메모", { exact: false }).fill(memo);
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("status").filter({ hasText: "저장했어요." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: memo })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요." })).toHaveCount(0);
});
