import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { searchFoods } from "../../src/lib/server/services";
import { DemoStore } from "../../src/lib/server/demo-store";
import type { RequestContext } from "../../src/lib/server/session";
import { FOOD_HEADERS, normalizeFoodFile } from "../../scripts/lib/food-catalog-import.mjs";
import { randomFoodSample } from "../../src/lib/domain/food-search";

test("무작위 목록은 전체 후보에서 중복 없이 선택하고 원본을 바꾸지 않는다", () => {
  const all = Array.from({ length: 1000 }, (_, index) => index);
  const selected = randomFoodSample(all, 100, () => 0.999);
  assert.equal(selected.length, 100);
  assert.equal(new Set(selected).size, 100);
  assert.ok(selected.includes(999));
  assert.deepEqual(all, Array.from({ length: 1000 }, (_, index) => index));
  assert.deepEqual(randomFoodSample([], 100), []);
  assert.deepEqual(randomFoodSample([1, 2], 100, () => 0), [1, 2]);
});

test("음식 검색은 선행 물음표를 개수·100개 제한보다 먼저 제외하고 원본을 보존한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-search-"));
  const filename = path.join(directory, "catalog.json");
  const previous = process.env.FOOD_CATALOG_FILE;
  process.env.FOOD_CATALOG_FILE = filename;
  try {
    const names = ["?검사 제외", "？검사 제외", "  ?검사 제외", ...Array.from({ length: 101 }, (_, i) => `검사 정상 ${i}`), "검사?정상"];
    const rows = names.map((name, i) => [`S${i}`, name, "음식", "50", "100g", "1", "0", "2", "3", "0", "0", "100g", "검사기관"].join(","));
    const original = JSON.stringify(normalizeFoodFile(Buffer.from([FOOD_HEADERS.join(","), ...rows].join("\n"))));
    await writeFile(filename, original);
    const context: RequestContext = { session: { mode: "demo", consent: "current", user: { id: randomUUID(), email: "food-test@example.invalid" } }, store: new DemoStore(path.join(directory, "store.json")) };
    const result = await searchFoods(context, "검사");
    assert.equal(result.matched_count, 102);
    assert.equal(result.foods.length, 100);
    assert.equal(result.truncated, true);
    assert.ok(result.foods.every(food => !/^\s*[?？]/u.test(food.food_name)));
    assert.equal((await searchFoods(context, "제외")).matched_count, 0);
    assert.equal((await searchFoods(context, "검사?정상")).matched_count, 1);
    assert.equal(await readFile(filename, "utf8"), original);
  } finally {
    if (previous === undefined) delete process.env.FOOD_CATALOG_FILE; else process.env.FOOD_CATALOG_FILE = previous;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.match(path.basename(directory), /^food-search-/);
    await rm(directory, { recursive: true, force: true });
  }
});
