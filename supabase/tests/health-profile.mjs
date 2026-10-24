import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// 실제 연결 정보 없이 메모리 PostgreSQL에서 가상 계정만 사용해요.
const db = new PGlite();
const a = "a0000000-0000-4000-8000-000000000001";
const b = "b0000000-0000-4000-8000-000000000002";
const c = "c0000000-0000-4000-8000-000000000003";
const base = { sex: "female", age: 30, height_cm: 165.2, weight_kg: 55.1, allow_storage: true, notice_version: "health-profile-v1" };
let count = 0;
const passed = label => { count++; console.log(`ok - ${label}`); };
async function identity(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec(`set role ${role}`);
}
async function save(profile = base, expected = null) {
  return (await db.query("select public.save_health_profile($1::jsonb,$2::timestamptz) as profile", [JSON.stringify(profile), expected])).rows[0].profile;
}
async function remove(expected) {
  await db.query("select public.delete_health_profile($1::timestamptz)", [expected]);
}
async function rejects(label, fn, code) {
  await assert.rejects(fn(), { code }); passed(label);
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable security invoker set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const file of ["20261020000100_glucose_records.sql", "20261023000100_health_profiles.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1,'a@example.invalid'),($2,'b@example.invalid'),($3,'c@example.invalid')", [a, b, c]);
  await identity(a, "anon");
  await rejects("anonymous cannot read profiles even with a subject claim", () => db.query("select * from public.health_profiles"), "42501");
  await rejects("anonymous cannot save", () => save(), "42501");
  await rejects("anonymous cannot delete", () => remove("2026-10-23T00:00:00Z"), "42501");
  await identity(null);
  await rejects("authenticated role without identity cannot save", () => save(), "42501");
  await rejects("authenticated role without identity cannot delete", () => remove("2026-10-23T00:00:00Z"), "42501");
  await identity(a);
  await rejects("current app consent is required for first save", () => save(), "42501");
  await db.query("insert into public.user_consents(user_id,policy_version) values ($1,'demo-v3')", [a]);
  for (const [name, changes] of [
    ["missing storage consent", { allow_storage: undefined }], ["false storage consent", { allow_storage: false }],
    ["string storage consent", { allow_storage: "true" }], ["outdated notice", { notice_version: "old" }],
    ["missing notice", { notice_version: undefined }], ["unknown field", { user_id: b }],
    ["negative age", { age: -1 }], ["large age", { age: 121 }], ["fractional age", { age: 30.5 }],
    ["string age", { age: "30" }], ["short height", { height_cm: 29.9 }], ["tall height", { height_cm: 250.1 }],
    ["height precision", { height_cm: 160.11 }], ["weight below range", { weight_kg: 0.9 }],
    ["weight above range", { weight_kg: 500.1 }], ["weight precision", { weight_kg: 55.15 }],
    ["unknown sex", { sex: "invalid" }], ["array sex", { sex: ["female"] }],
    ["all empty", { sex: null, age: null, height_cm: null, weight_kg: null }],
  ]) await rejects(name, () => save({ ...base, ...changes }), "23514");
  await rejects("null JSON rejected", () => save(null), "23514");
  await rejects("array JSON rejected", () => save([]), "23514");
  await rejects("infinite expected timestamp rejected", () => save(base, "infinity"), "23514");
  assert.equal((await db.query("select count(*)::int n from public.health_profiles")).rows[0].n, 0);
  passed("rejected saves leave no record");
  const first = await save();
  assert.equal(first.user_id, a);
  assert.equal(first.height_cm, 165.2);
  assert.equal(first.notice_version, "health-profile-v1");
  assert.equal(first.consented_at, first.updated_at);
  passed("first save records caller, values and server consent time");
  assert.equal((await db.query("select user_id from public.health_profiles")).rows[0].user_id, a);
  passed("owner reads own row");
  await rejects("second first-save cannot overwrite existing row", () => save(), "PT409");
  await rejects("direct insert is denied", () => db.query("insert into public.health_profiles(user_id,age,notice_version,consented_at,created_at,updated_at) values($1,40,'health-profile-v1',now(),now(),now())", [b]), "42501");
  await rejects("direct update cannot bypass consent or conflict check", () => db.query("update public.health_profiles set age=40 where user_id=$1", [a]), "42501");
  await rejects("direct delete cannot bypass conflict check", () => db.query("delete from public.health_profiles where user_id=$1", [a]), "42501");
  await identity(b);
  assert.deepEqual((await db.query("select * from public.health_profiles")).rows, []);
  passed("other account cannot read or discover profile rows");
  await remove(first.updated_at);
  passed("other account deletion is scoped to its absent row");
  await db.query("insert into public.user_consents(user_id,policy_version) values ($1,'demo-v3')", [b]);
  const secondUser = await save({ ...base, age: 0, height_cm: 30, weight_kg: 1, sex: "other" });
  assert.equal(secondUser.user_id, b); assert.equal(secondUser.age, 0);
  passed("lower range boundaries and other sex save for second account");
  await identity(a);
  const upper = await save({ ...base, age: 120, height_cm: 250, weight_kg: 500 }, first.updated_at);
  assert.equal(upper.created_at, first.created_at); assert.notEqual(upper.updated_at, first.updated_at);
  passed("upper boundaries save while creation time is immutable and version changes");
  await rejects("stale update conflicts", () => save(base, first.updated_at), "PT409");
  await rejects("stale delete conflicts", () => remove(first.updated_at), "PT409");
  const partial = await save({ ...base, sex: null, age: null, height_cm: null, weight_kg: 60.3 }, upper.updated_at);
  assert.equal(partial.sex, null); assert.equal(partial.age, null); assert.equal(partial.height_cm, null);
  passed("clearing optional fields preserves remaining value");
  await rejects("delete requires version", () => remove(null), "23514");
  await rejects("delete rejects infinite version", () => remove("infinity"), "23514");
  await db.exec("reset role");
  await db.query("update public.user_consents set policy_version='old' where user_id=$1", [a]);
  await identity(a);
  assert.equal((await db.query("select count(*)::int n from public.health_profiles")).rows[0].n, 1);
  passed("outdated app consent still allows own read");
  await rejects("outdated app consent blocks edit", () => save(base, partial.updated_at), "42501");
  await remove(partial.updated_at); await remove(partial.updated_at);
  passed("outdated consent allows deletion and repeated deletion is idempotent");
  await db.exec("reset role");
  await db.query("update public.user_consents set policy_version='demo-v3' where user_id=$1", [a]);
  await identity(a);
  await rejects("stale update cannot recreate a deleted row", () => save(base, partial.updated_at), "PT409");
  const recreated = await save();
  await rejects("stale delete cannot remove recreated row", () => remove(partial.updated_at), "PT409");
  assert.notEqual(recreated.updated_at, partial.updated_at);
  passed("explicit first save can recreate deleted profile with new version");
  await identity(c);
  assert.deepEqual((await db.query("select * from public.health_profiles")).rows, []);
  passed("third account without consent cannot see other profiles");
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [a]);
  assert.deepEqual((await db.query("select user_id from public.health_profiles")).rows.map(row => row.user_id), [b]);
  passed("account deletion cascades only its profile and preserves another account");
  await identity(a);
  await rejects("deleted account cannot recreate profile through RPC", () => save(), "42501");
  await rejects("deleted account cannot delete through RPC", () => remove(recreated.updated_at), "42501");
  console.log(`PASS: ${count} isolated SQL health profile checks.`);
  console.log("Not covered: hosted Supabase Auth/PostgREST or simultaneous transactions on multiple database connections.");
} finally { await db.close(); }
