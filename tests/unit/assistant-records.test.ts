import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fastingRecordSummary, summarizeFastingRecords } from "../../src/lib/assistant/record-summary";
import { DEMO_USERS, DemoStore } from "../../src/lib/server/demo-store";
import { ApiError } from "../../src/lib/server/errors";
import type { RequestContext } from "../../src/lib/server/session";
import type { GlucoseRecord } from "../../src/lib/domain";

const now = new Date("2026-10-22T01:00:00Z"); // 한국시간 10시
const owner = DEMO_USERS.a.id;
const env = { ASSISTANT_ENABLED: "1" };
const consent = { allow_record_access: true };
const hasCode = (code: string) => (e: unknown) => e instanceof ApiError && e.code === code;
const session = { user: DEMO_USERS.a, mode: "demo", consent: "current" } as const;
function record(id: number, value: number, time: string, context: GlucoseRecord["measurement_context"] = "fasting", user: string = owner): GlucoseRecord {
  return { id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`, user_id: user, glucose_mg_dl: value,
    measured_at: time, measurement_context: context, meal_memo: "PRIVATE_MEMO_NEVER_SEND", created_at: now.toISOString(), updated_at: now.toISOString() };
}

test("seven Seoul calendar days include start and now, exclude future/end/other contexts/owners, weight measurements and round once", () => {
  const rows = [record(1, 100, "2026-10-15T15:00:00Z"), record(2, 102, "2026-10-15T16:00:00Z"), record(3, 103, now.toISOString()),
    record(4, 999, "2026-10-15T14:59:59Z"), record(5, 999, "2026-10-22T01:00:01Z"), record(6, 999, "2026-10-22T15:00:00Z"),
    record(7, 999, now.toISOString(), "before_meal"), record(8, 999, now.toISOString(), "on_waking"), record(9, 999, now.toISOString(), "fasting", DEMO_USERS.b.id)];
  const result = summarizeFastingRecords(rows, owner, now);
  assert.deepEqual([result.count, result.average, result.min, result.max, result.recordedDays, result.missingDays], [3, 101.7, 100, 103, 2, 5]);
  assert.equal(result.range.start, "2026-10-15T15:00:00.000Z");
  assert.equal(result.range.end, "2026-10-22T15:00:00.000Z");
  assert.equal(result.range.label, "2026-10-16 ~ 2026-10-22");
  assert.equal(result.timezone, "Asia/Seoul");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_MEMO"));
});

test("empty and singleton summaries retain nulls and do not count missing days as zero measurements", () => {
  const empty = summarizeFastingRecords([], owner, now);
  assert.deepEqual([empty.count, empty.average, empty.min, empty.max, empty.recordedDays, empty.missingDays], [0, null, null, null, 0, 7]);
  const single = summarizeFastingRecords([record(1, 109, now.toISOString())], owner, now);
  assert.deepEqual([single.count, single.average, single.min, single.max, single.missingDays], [1, 109, 109, 109, 6]);
});

test("record summary denies missing authentication, either consent, disabled feature and caller-selected owners before storage", async () => {
  const context: RequestContext = { session };
  const options = { env, now, revalidate: async () => context };
  await assert.rejects(fastingRecordSummary({ session: { ...session, user: null } }, consent, options), hasCode("UNAUTHORIZED"));
  for (const status of ["missing", "outdated"] as const) {
    await assert.rejects(fastingRecordSummary({ session: { ...session, consent: status } }, consent, options), hasCode("RECORD_CONSENT_REQUIRED"));
  }
  for (const body of [{}, { allow_record_access: false }, { allow_record_access: "true" }]) {
    await assert.rejects(fastingRecordSummary(context, body, options), hasCode("RECORD_ACCESS_CONSENT_REQUIRED"));
  }
  for (const field of ["user_id", "start", "end", "question", "records"]) {
    await assert.rejects(fastingRecordSummary(context, { ...consent, [field]: "tamper" }, options), hasCode("INVALID_INPUT"));
  }
  await assert.rejects(fastingRecordSummary(context, consent, { ...options, env: {} }), hasCode("ASSISTANT_UNAVAILABLE"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fastingRecordSummary(context, consent, { ...options, signal: controller.signal }), hasCode("ASSISTANT_CANCELLED"));
});

test("real demo storage isolates owners; no model config is needed; access is rechecked and cancelled results are withheld", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "assistant-records-"));
  const store = new DemoStore(path.join(folder, "synthetic.json"));
  try {
    await store.agree(owner); await store.agree(DEMO_USERS.b.id);
    await store.insert(owner, record(10, 101, now.toISOString()).id, record(10, 101, now.toISOString()));
    await store.insert(DEMO_USERS.b.id, record(11, 999, now.toISOString()).id, record(11, 999, now.toISOString()));
    const context: RequestContext = { session, store };
    const options = { env, now, revalidate: async () => context };
    const result = await fastingRecordSummary(context, consent, options);
    // Initial seed records vary with wall clock, so compare with this owner's full actual filtered store.
    const expected = summarizeFastingRecords(await store.list(owner, result.recordSummary!.range), owner, now);
    assert.deepEqual(result.recordSummary, expected);
    assert.equal(result.kind, "record_summary"); assert.deepEqual(result.citations, []);
    assert.ok(!JSON.stringify(result).includes("999"));
    assert.ok(!JSON.stringify(result).includes("PRIVATE_MEMO"));
    assert.ok(!JSON.stringify(result).includes(owner));
    assert.match(result.answer, /측정 건수/);
    await assert.rejects(fastingRecordSummary(context, consent, { ...options, revalidate: async () => ({ session: { ...session, user: null } }) }), hasCode("UNAUTHORIZED"));
    await assert.rejects(fastingRecordSummary(context, consent, { ...options, revalidate: async () => ({ session: { ...session, user: DEMO_USERS.b } }) }), hasCode("UNAUTHORIZED"));
    await assert.rejects(fastingRecordSummary(context, consent, { ...options, revalidate: async () => ({ session: { ...session, consent: "missing" } }) }), hasCode("RECORD_CONSENT_REQUIRED"));
    const controller = new AbortController();
    await assert.rejects(fastingRecordSummary(context, consent, { ...options, signal: controller.signal, revalidate: async () => { controller.abort(); return context; } }), hasCode("ASSISTANT_CANCELLED"));
  } finally {
    assert.equal(path.dirname(folder), path.resolve(tmpdir()));
    assert.ok(path.basename(folder).startsWith("assistant-records-"));
    await rm(folder, { recursive: true, force: true });
  }
});
