import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { listRecords, insertRecord, updateRecord, databaseError } from "../../src/lib/server/records";
import type { RequestContext } from "../../src/lib/server/session";
import { ApiError } from "../../src/lib/server/errors";
import type { GlucoseRecord } from "../../src/lib/domain";

const owner = "11111111-1111-4111-8111-111111111111";
const base: GlucoseRecord = {
  id: "10000000-0000-4000-8000-000000000001",
  user_id: owner,
  glucose_mg_dl: 100,
  measured_at: "2026-10-20T00:00:00.000Z",
  measurement_context: "fasting",
  meal_memo: null,
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-20T00:00:00.000Z",
};
type Page = { data: GlucoseRecord[] | null; error: { code: string } | null };
function contextWithPages(pages: Page[]) {
  let calls = 0;
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    gte: (key: string, value: unknown) => { filters.push([`gte:${key}`, value]); return query; },
    lt: (key: string, value: unknown) => { filters.push([`lt:${key}`, value]); return query; },
    order: () => query,
    limit: () => query,
    or: (value: string) => { filters.push(["cursor", value]); return query; },
    then: (resolve: (value: Page) => unknown) => resolve(pages[calls++] ?? { data: [], error: null }),
  };
  const context: RequestContext = {
    session: { user: { id: owner, email: "a@example.invalid" }, mode: "supabase", consent: "current" },
    supabase: { from: () => query } as unknown as SupabaseClient,
  };
  return { context, filters, calls: () => calls };
}

test("record pagination continues past a smaller server row cap and preserves equal-time rows", async () => {
  const second = { ...base, id: "10000000-0000-4000-8000-000000000002" };
  const mock = contextWithPages([
    { data: [base], error: null },
    { data: [second], error: null },
    { data: [], error: null },
  ]);
  const result = await listRecords(mock.context, "2026-10-20");
  assert.deepEqual(result.records.map((record) => record.id), [second.id, base.id]);
  assert.equal(mock.calls(), 3);
  assert.equal(mock.filters.filter(([key]) => key === "user_id").length, 3);
  assert.ok(mock.filters.some(([key, value]) => key === "cursor" && String(value).includes(`id.gt.${base.id}`)));
  assert.ok(mock.filters.some(([key, value]) => key === "gte:measured_at" && value === "2026-10-19T15:00:00.000Z"));
  assert.ok(mock.filters.some(([key, value]) => key === "lt:measured_at" && value === "2026-10-20T15:00:00.000Z"));
});

test("a later page failure rejects the entire result instead of rendering a partial graph", async () => {
  const mock = contextWithPages([
    { data: [base], error: null },
    { data: null, error: { code: "NETWORK" } },
  ]);
  await assert.rejects(
    listRecords(mock.context, "2026-10-20"),
    (error: unknown) => error instanceof ApiError && error.code === "DATA_UNAVAILABLE",
  );
});

test("unexpected duplicate pages and invalid dates cannot cause silent loss or endless pagination", async () => {
  const mock = contextWithPages([
    { data: [base], error: null },
    { data: [base], error: null },
  ]);
  await assert.rejects(
    listRecords(mock.context, "2026-10-20"),
    (error: unknown) => error instanceof ApiError && error.code === "INCOMPLETE_DATA",
  );
  assert.equal(mock.calls(), 2);
  const invalid = contextWithPages([]);
  await assert.rejects(
    listRecords(invalid.context, "2026-10-20,or(id.gt.any)"),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_DATE",
  );
  assert.equal(invalid.calls(), 0);
});

test("API rejects attempts to override protected server fields before database writes", async () => {
  const mock = contextWithPages([]);
  await assert.rejects(
    insertRecord(mock.context, { ...base }),
    (error: unknown) => error instanceof ApiError && error.code === "IMMUTABLE_FIELD",
  );
  await assert.rejects(
    updateRecord(mock.context, base.id, { ...base, expected_updated_at: base.updated_at }),
    (error: unknown) => error instanceof ApiError && error.code === "IMMUTABLE_FIELD",
  );
  assert.equal(mock.calls(), 0);
});

test('explicit database HTTP conflict becomes a sanitized stale-record response',()=>{
  assert.throws(()=>databaseError({code:'PT409',message:'private database diagnostic'},true),(error:unknown)=>error instanceof ApiError&&error.status===409&&error.code==='STALE_RECORD'&&!error.message.includes('private'));
});

test('installed Supabase client sends one POST for both serialization and explicit conflict responses',async()=>{
  for(const [code,status] of [['40001',500],['PT409',409]] as const){
    let calls=0;
    const client=createClient('https://fixture.example.invalid','fixture-publishable-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(_input,init)=>{
      calls++;assert.equal(init?.method,'POST');
      return new Response(JSON.stringify({code,message:'fixture error',details:null,hint:null}),{status,headers:{'Content-Type':'application/json'}});
    }}});
    const response=await client.rpc('save_meal_record',{p_id:base.id,p_meal:{},p_expected_updated_at:base.updated_at});
    assert.equal(calls,1);assert.equal(response.status,status);assert.equal(response.error?.code,code);
  }
});
