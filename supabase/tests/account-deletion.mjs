import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = "a0000000-0000-4000-8000-000000000001";
const b = "b0000000-0000-4000-8000-000000000002";
const sid = "c0000000-0000-4000-8000-000000000001";
let count = 0;
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create table auth.sessions (id uuid primary key, user_id uuid references auth.users on delete cascade, created_at timestamptz default now());
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims', true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.jwt(), auth.uid() to authenticated, anon;
  `);
  for (const file of ["20261020000100_glucose_records.sql", "20261021000100_self_service_account.sql", "20261021000200_non_ai_features.sql", "20261021000300_reviewed_catalog.sql", "20261021000400_meal_stale_conflict.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1, 'a@example.invalid'), ($2, 'b@example.invalid')", [a, b]);
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [sid, a]);
  await db.query("insert into public.user_consents(user_id,policy_version) values ($1,'demo-v3'),($2,'demo-v3')", [a, b]);
  await db.query("insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values (gen_random_uuid(),$1,117,now(),'fasting'),(gen_random_uuid(),$2,123,now(),'fasting')", [a, b]);
  async function claims(overrides = {}) {
    const jwt = { sub: a, role: "authenticated", session_id: sid, amr: [{ method: "password", timestamp: Math.floor(Date.now()/1000) }], ...overrides };
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(jwt)]);
  }
  async function denied(label) {
    await assert.rejects(db.query("select public.delete_my_account()"), { code: "42501" });
    count++; console.log(`ok - ${label}`);
  }
  await claims();
  await db.exec('set role authenticated');
  await db.query("select public.save_meal_record(gen_random_uuid(),$1::jsonb,null)",[JSON.stringify({meal_at:'2026-10-21T03:00:00Z',meal_type:'lunch',memo:null,items:[{free_text:'가상 식사',amount_value:1,amount_unit:'개'}]})]);
  await db.query("insert into public.user_preferences(user_id,matching_enabled,notice_version) values($1,false,'matching-v1')",[a]);
  await db.query("select public.import_glucose_csv(gen_random_uuid(),$1,$2::jsonb)",['a'.repeat(64),JSON.stringify([{glucose_mg_dl:110,measured_at:'2026-10-21T03:00:00.000Z',measurement_context:'after_meal',meal_slot:'lunch',meal_memo:null}])]);
  await db.exec('reset role');
  await db.exec("set role anon"); await denied("anonymous cannot call deletion");
  await db.exec("reset role; set role authenticated");
  await claims({ sub: null }); await denied("missing identity denied");
  await claims({ amr: [{ method: "oauth", timestamp: Math.floor(Date.now()/1000) }] }); await denied("non-password authentication denied");
  await claims({ amr: [{ method: "password", timestamp: Math.floor(Date.now()/1000)-3600 }] }); await denied("old password authentication denied");
  await claims({ session_id: b }); await denied("unrelated or nonexistent session denied");
  await claims({ sub: b }); await denied("another user's session cannot delete caller");
  await db.exec("reset role");
  await db.query("update auth.sessions set created_at = now()-interval '1 hour'");
  await db.exec("set role authenticated"); await claims(); await denied("refreshing an old session does not satisfy reauthentication");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n, 2);
  await db.query("update auth.sessions set created_at = now()");
  await db.exec("set role authenticated"); await claims();
  await db.query("select public.delete_my_account()");
  await db.exec("reset role");
  for (const table of ["auth.users", "public.user_consents", "public.glucose_records"]) {
    const idColumn = table === "auth.users" ? "id" : "user_id";
    const rows = (await db.query(`select ${idColumn} as id from ${table}`)).rows;
    assert.deepEqual(rows.map(r => r.id), [b]); count++;
  }
  assert.equal((await db.query("select count(*)::int n from auth.sessions")).rows[0].n, 0); count++;
  for(const table of ['meal_records','meal_items','user_preferences','import_batches','import_requests']) {
    assert.equal((await db.query(`select count(*)::int n from public.${table} where user_id=$1`,[a])).rows[0].n,0); count++;
  }
  assert.ok((await db.query('select count(*)::int n from public.food_catalog')).rows[0].n>0); count++;
  assert.ok((await db.query('select count(*)::int n from public.benefit_rules')).rows[0].n>0); count++;
  console.log(`PASS: ${count} deletion checks; own account, records, meals, settings, imports, consent and sessions removed; other account and shared catalogs preserved.`);
} finally { await db.close(); }
