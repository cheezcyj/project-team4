import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// 실제 Supabase에 연결하지 않고 원래 스키마·권한·새 함수를 함께 검증합니다.
const db = new PGlite();
let checks = 0;
const ok = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const sample = async () => (await db.query("select public.random_food_catalog() as result")).rows[0].result;
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const name of ["20261020000100_glucose_records.sql", "20261021000200_non_ai_features.sql", "20261021000300_reviewed_catalog.sql", "20261024000300_random_food_catalog.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const template = (await db.query("select * from public.food_catalog limit 1")).rows[0];
  const names = [...Array.from({ length: 250 }, (_, index) => `검사 정상 ${index}`), "?제외", "  ？제외", "\t?제외", "검토 중 음식"];
  const rows = names.map((name, index) => ({ ...template, id: randomUUID(), food_name: name, source_code: `FIXTURE-${index}`, status: index === 253 ? "review" : "approved" }));
  await db.query("insert into public.food_catalog select * from jsonb_populate_recordset(null::public.food_catalog,$1::jsonb)", [JSON.stringify(rows)]);
  const before = (await db.query("select count(*) as count from public.food_catalog")).rows[0].count;
  await db.exec("set role authenticated; select setseed(0.1)");
  const first = await sample();
  ok(first.matched_count, 258, "제외·검토 항목은 개수에 포함하지 않음");
  ok(first.foods.length, 100, "100개 제한");
  ok(new Set(first.foods.map(food => food.id)).size, 100, "중복 없는 선택");
  ok(first.truncated, true, "더 많은 후보 표시");
  ok(first.foods.every(food => food.status === "approved" && !/^\s*[?？]/u.test(food.food_name)), true, "검색과 같은 제외 규칙");
  await db.exec("select setseed(0.7)");
  const second = await sample();
  ok(JSON.stringify(first.foods.map(food => food.id)) === JSON.stringify(second.foods.map(food => food.id)), false, "매 요청 새 표본 선택");
  await db.exec("reset role");
  ok((await db.query("select count(*) as count from public.food_catalog")).rows[0].count, before, "조회는 자료를 변경하지 않음");
  ok((await db.query("select prosecdef from pg_proc where oid='public.random_food_catalog()'::regprocedure")).rows[0].prosecdef, false, "호출자 권한 유지");
  await db.exec("set role anon");
  await assert.rejects(sample(), { code: "42501" }); checks++;
  await db.exec("reset role; create policy test_restriction on public.food_catalog as restrictive for select to authenticated using(food_name <> '검사 정상 0'); set role authenticated");
  ok((await sample()).matched_count, 257, "추가 행 접근 제어도 유지");
  await db.exec("reset role; update public.food_catalog set status='blocked'; set role authenticated");
  ok(await sample(), { foods: [], matched_count: 0, truncated: false, limit: 100 }, "빈 목록도 정상 반환");
  console.log(`PASS: ${checks} random food SQL checks; isolated PostgreSQL only.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
