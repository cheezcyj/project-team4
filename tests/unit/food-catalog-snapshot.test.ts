import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareDemoFoodCatalog } from "../../scripts/lib/demo-food-catalog.mjs";
import { localFoodCatalog } from "../../src/lib/server/food-catalog";
import { searchFoods } from "../../src/lib/server/services";
import { DemoStore } from "../../src/lib/server/demo-store";
import type { RequestContext } from "../../src/lib/server/session";

test("새 환경에서 공개 음식 50,002개와 무작위 목록을 재현하고 변경된 캐시는 보존한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "team-food-snapshot-"));
  const previous = process.env.FOOD_CATALOG_FILE;
  try {
    await mkdir(path.join(root, "resources", "foods"), { recursive: true });
    for (const name of ["manifest.json", "mfds-nutrition.csv"]) {
      await copyFile(path.join("resources", "foods", name), path.join(root, "resources", "foods", name));
    }
    const filenames = await Promise.all([prepareDemoFoodCatalog(root), prepareDemoFoodCatalog(root)]);
    assert.equal(filenames[0], filenames[1]);
    const filename = filenames[0];
    const before = await stat(filename);
    assert.equal(await prepareDemoFoodCatalog(root), filename);
    assert.equal((await stat(filename)).mtimeMs, before.mtimeMs);
    process.env.FOOD_CATALOG_FILE = filename;
    const catalog = await localFoodCatalog();
    assert.equal(catalog.foods.length, 50008);
    assert.equal(new Set(catalog.foods.map(food => food.id)).size, 50008);
    assert.equal(catalog.foods.filter(food => /^\s*[?？]/u.test(food.food_name)).length, 6);
    const imported = catalog.foods.find(food => food.source_code === "D501-052000000-0001")!;
    assert.equal(imported.id, "4646adaa-61e0-821c-aa01-8c20214d984d");
    assert.equal(imported.basis_unit, "ml");
    assert.equal(imported.kcal, 120);
    assert.equal(imported.unit_validated, false);
    assert.equal(catalog.foods.find(food => food.source_code === "USDA-FDC-170392")?.unit_validated, true);
    const context: RequestContext = { session: { mode: "demo", consent: "current", user: { id: randomUUID(), email: "snapshot@example.invalid" } }, store: new DemoStore(path.join(root, ".local", "test-records.json")) };
    const result = await searchFoods(context, "");
    assert.equal(result.matched_count, 50002);
    assert.equal(result.foods.length, 100);
    assert.equal(new Set(result.foods.map(food => food.id)).size, 100);
    assert.equal(result.truncated, true);
    assert.equal(result.randomized, true);
    assert.ok(result.foods.every(food => !/^\s*[?？]/u.test(food.food_name)));
    for (const punctuation of ["?", "？"]) {
      const matches = await searchFoods(context, punctuation);
      assert.ok(matches.foods.every(food => !/^\s*[?？]/u.test(food.food_name)));
    }
    const search = await searchFoods(context, "가래떡");
    assert.equal(search.randomized, false);
    assert.deepEqual(search.foods.slice(0, 3).map(food => food.food_name), ["가래떡", "가래떡", "가래떡_흑미"]);
    const original = await readFile(filename, "utf8");
    const changed = original.replace('"kcal":120', '"kcal":999');
    assert.notEqual(changed, original);
    await writeFile(filename, changed);
    await assert.rejects(prepareDemoFoodCatalog(root), /캐시가 변경/);
    assert.equal(await readFile(filename, "utf8"), changed);
    await writeFile(path.join(root, "resources", "foods", "mfds-nutrition.csv"), "changed");
    await assert.rejects(prepareDemoFoodCatalog(root), /CSV의 확인값/);
  } finally {
    if (previous === undefined) delete process.env.FOOD_CATALOG_FILE; else process.env.FOOD_CATALOG_FILE = previous;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.match(path.basename(root), /^team-food-snapshot-/);
    await rm(root, { recursive: true, force: true });
  }
});
