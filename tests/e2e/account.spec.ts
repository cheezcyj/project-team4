import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("header account opens my page and anonymous access returns to login", async ({ page }) => {
  await page.goto("/mypage");
  await expect(page).toHaveURL(/\/login\?next=%2Fmypage/);
  await page.getByRole("button", { name: "가상 계정 A로 시작" }).click();
  await expect(page.getByRole("link", { name: "가상 계정 A 마이페이지" })).toBeVisible();
  await page.getByRole("link", { name: "가상 계정 A 마이페이지" }).click();
  await expect(page).toHaveURL(/\/mypage$/);
  await expect(page.getByRole("heading", { name: "마이페이지", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "회원 탈퇴", exact: true })).toBeVisible();
  await expect(page.getByText("가상 계정은 탈퇴할 수 없어요.")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("signup validates fields and keeps passwords masked", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page.getByLabel("이메일", { exact: true })).toBeFocused();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByLabel("비밀번호 확인", { exact: true })).toHaveAttribute("type", "password");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
