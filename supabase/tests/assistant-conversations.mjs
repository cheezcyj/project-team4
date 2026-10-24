import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = "a0000000-0000-4000-8000-000000000001";
const b = "b0000000-0000-4000-8000-000000000002";
const c = "c0000000-0000-4000-8000-000000000003";
const answer = { kind: "answer", answer: "가상 건강정보 답변입니다.", citations: [
  { id: "test", title: "가상 자료", publisher: "검증용", url: "https://example.invalid/health", pdfPages: [],
    attribution: "Test", licenseLabel: "CC0", licenseUrl: "https://example.invalid/license", retrievedAt: "2026-10-23T00:00:00.000Z",
    section: "검사 안내", evidenceRole: "label_basis", reuseLabel: "검증용 이용조건", reuseUrl: "https://example.invalid/reuse", adaptationNotice: "한국어 재구성" },
], draftPreview: false, sourceSupplemented: true };
const summaryAnswer = { kind: "record_summary", answer: "가상 공복 기록 2건의 평균은 110.5 mg/dL입니다.", citations: [], draftPreview: false,
  recordSummary: { range: { start: "2026-10-17T15:00:00.000Z", end: "2026-10-24T15:00:00.000Z", label: "2026-10-18 ~ 2026-10-24" },
    asOf: "2026-10-24T00:00:00.000Z", timezone: "Asia/Seoul", measurementContext: "fasting", unit: "mg/dL",
    count: 2, recordedDays: 2, missingDays: 5, average: 110.5, min: 110, max: 111 } };
const summaryWith = changes => ({ ...summaryAnswer, recordSummary: { ...summaryAnswer.recordSummary, ...changes } });
const emptySummary = summaryWith({ count: 0, recordedDays: 0, missingDays: 7, average: null, min: null, max: null });
const invalidSummaries = [
  { ...summaryAnswer, draftPreview: true }, { ...summaryAnswer, sourceSupplemented: false },
  { ...summaryAnswer, citations: [answer.citations[0]] }, { ...answer, recordSummary: summaryAnswer.recordSummary },
  { ...summaryAnswer, recordSummary: undefined }, summaryWith({ privateMemo: "not stored" }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, extra: true } }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, label: "" } }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, label: "가".repeat(101) } }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, end: "2026-10-25T15:00:00.000Z" } }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, start: "2026-02-30T00:00:00Z" } }),
  summaryWith({ asOf: "2026-10-17T14:59:59.999Z" }), summaryWith({ asOf: summaryAnswer.recordSummary.range.end }),
  summaryWith({ asOf: "2026-02-30T00:00:00Z" }), summaryWith({ asOf: "infinity" }),
  summaryWith({ asOf: "2026-10-23T24:00:00Z" }), summaryWith({ asOf: "2026-10-23T23:59:60Z" }),
  summaryWith({ range: { ...summaryAnswer.recordSummary.range, start: "2026-10-17T24:00:00Z", end: "2026-10-24T24:00:00Z" } }),
  summaryWith({ timezone: "UTC" }), summaryWith({ measurementContext: "after_meal" }), summaryWith({ unit: "mmol/L" }),
  summaryWith({ count: -1 }), summaryWith({ count: 1.5 }), summaryWith({ count: 2147483648 }), summaryWith({ count: "2" }),
  summaryWith({ count: 0 }), summaryWith({ recordedDays: 0, missingDays: 7 }), summaryWith({ recordedDays: 3, missingDays: 4 }),
  summaryWith({ recordedDays: 8, missingDays: -1 }), summaryWith({ recordedDays: 1.5, missingDays: 5.5 }),
  summaryWith({ missingDays: 4 }), summaryWith({ missingDays: "5" }),
  summaryWith({ average: 109 }), summaryWith({ average: 112 }), summaryWith({ average: null }), summaryWith({ average: "NaN" }),
  summaryWith({ min: 0 }), summaryWith({ min: 110.5 }), summaryWith({ max: 2147483648 }), summaryWith({ max: null }),
  { ...emptySummary, recordSummary: { ...emptySummary.recordSummary, average: 0 } },
  { ...emptySummary, recordSummary: { ...emptySummary.recordSummary, min: undefined } },
];
let count = 0;
const passed = label => { count++; console.log(`ok - ${label}`); };
async function identity(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec(`set role ${role}`);
}
async function create(id = randomUUID(), changes = {}) {
  return (await db.query("select public.create_assistant_conversation($1::jsonb) as room", [JSON.stringify({
    id, allow_storage: true, notice_version: "assistant-chat-v1", ...changes,
  })])).rows[0].room;
}
async function begin(room, id = randomUUID(), question = "당화혈색소란 무엇인가요?", changes = {}) {
  return (await db.query("select public.begin_assistant_turn($1::uuid,$2::jsonb) as result", [room.id,
    JSON.stringify({ id, question, expected_updated_at: room.updated_at, ...changes })])).rows[0].result;
}
async function finish(attempt, result = answer, error = null) {
  return (await db.query("select public.finish_assistant_turn($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::text) as room",
    [attempt.room.id, attempt.room.turns.at(-1).id, attempt.attemptId, result === null ? null : JSON.stringify(result), error])).rows[0].room;
}
async function remove(id) { await db.query("select public.delete_assistant_conversation($1::uuid)", [id]); }
async function rejects(label, fn, code) { await assert.rejects(fn(), { code }); passed(label); }
async function stored(id) {
  return (await db.query("select id,user_id,title,created_at,updated_at from public.assistant_conversations where id=$1", [id])).rows;
}

try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable security invoker set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  for (const file of ["20261020000100_glucose_records.sql", "20261023000200_assistant_conversations.sql", "20261024000100_assistant_citation_metadata.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const validatorId = (await db.query("select 'public.valid_assistant_answer(jsonb)'::regprocedure::oid as id")).rows[0].id;
  assert.equal((await db.query("select public.valid_assistant_answer($1::jsonb) as valid", [JSON.stringify(summaryAnswer)])).rows[0].valid, false);
  await db.exec(await readFile(new URL("../migrations/20261024000200_assistant_summary_history.sql", import.meta.url), "utf8"));
  assert.equal((await db.query("select 'public.valid_assistant_answer(jsonb)'::regprocedure::oid as id")).rows[0].id, validatorId);
  passed("summary migration preserves the validator identity referenced by existing table constraints");
  for (const value of [summaryAnswer, emptySummary,
    summaryWith({ asOf: summaryAnswer.recordSummary.range.start }),
    summaryWith({ count: 1, recordedDays: 1, missingDays: 6, average: 2147483647, min: 2147483647, max: 2147483647 }),
  ]) {
    assert.equal((await db.query("select public.valid_assistant_answer($1::jsonb) as valid", [JSON.stringify(value)])).rows[0].valid, true);
    passed("valid fasting summary preserves an exact bounded snapshot");
  }
  for (const [index, value] of invalidSummaries.entries()) {
    assert.equal((await db.query("select public.valid_assistant_answer($1::jsonb) as valid", [JSON.stringify(value)])).rows[0].valid, false, `invalid summary ${index + 1}`);
    passed(`invalid saved summary ${index + 1} rejected`);
  }
  await db.query("insert into auth.users values ($1,'a@example.invalid'),($2,'b@example.invalid'),($3,'c@example.invalid')", [a,b,c]);
  for (const [valid, value] of [
    [true, answer], [true, { kind: "answer", answer: "기존 답변", citations: [], draftPreview: false }],
    [false, { ...answer, sourceSupplemented: "true" }],
    [false, { ...answer, kind: "record_summary", recordSummary: { average: 120 } }],
    ...["section", "evidenceRole", "reuseLabel", "adaptationNotice"].map(key => [false, { ...answer, citations: [{ ...answer.citations[0], [key]: 123 }] }]),
    [false, { ...answer, citations: [{ ...answer.citations[0], reuseUrl: "javascript:alert(1)" }] }],
  ]) {
    const result = await db.query("select public.valid_assistant_answer($1::jsonb) as valid", [JSON.stringify(value)]);
    assert.equal(result.rows[0].valid, valid);
    passed("saved answer metadata compatibility and privacy boundary");
  }
  await identity(a, "anon");
  await rejects("anonymous cannot read rooms", () => stored(randomUUID()), "42501");
  await rejects("anonymous cannot read turns", () => db.query("select id,question from public.assistant_turns"), "42501");
  await rejects("anonymous cannot create", () => create(), "42501");
  await rejects("anonymous cannot delete", () => remove(randomUUID()), "42501");
  await identity(null);
  await rejects("missing identity cannot create", () => create(), "42501");
  await identity(a);
  await rejects("app consent is required", () => create(), "42501");
  await db.query("insert into public.user_consents(user_id,policy_version) values($1,'demo-v3')", [a]);
  for (const [label, changes] of [
    ["storage notice missing", { notice_version: undefined }], ["storage notice old", { notice_version: "old" }],
    ["storage consent missing", { allow_storage: undefined }], ["storage consent false", { allow_storage: false }],
    ["storage consent string", { allow_storage: "true" }], ["owner spoofing", { user_id: b }],
    ["title spoofing", { title: "Injected" }], ["invalid room UUID", { id: "bad" }],
  ]) await rejects(label, () => create(randomUUID(), changes), "23514");
  const first = await create();
  assert.equal(first.user_id,a); assert.equal(first.title,"새 대화"); assert.deepEqual(first.turns,[]);
  assert.deepEqual(await create(first.id),first); passed("create is durable and idempotent for the same owner");
  await rejects("raw room insert denied", () => db.query("insert into public.assistant_conversations(id,user_id,title,notice_version,consented_at,created_at,updated_at) values($1,$2,'x','assistant-chat-v1',now(),now(),now())",[randomUUID(),a]),"42501");
  await rejects("raw room update denied", () => db.query("update public.assistant_conversations set title='x'"),"42501");
  await rejects("raw room delete denied", () => db.query("delete from public.assistant_conversations"),"42501");
  await rejects("internal JSON helper denied", () => db.query("select public.assistant_room_json($1,$2)",[first.id,a]),"42501");
  await identity(b);
  assert.deepEqual(await stored(first.id),[]); passed("other account cannot discover room through RLS");
  await db.query("insert into public.user_consents(user_id,policy_version) values($1,'demo-v3')",[b]);
  await rejects("other account cannot claim room ID", () => create(first.id),"P0002");
  await rejects("other account cannot append to room", () => begin(first),"P0002");
  await remove(first.id); passed("other account delete is harmless and idempotent");
  const second = await create();
  await identity(a);
  assert.equal((await stored(first.id)).length,1); passed("foreign deletion preserves owner room");
  const summaryRoom = await create();
  const summaryAttempt = await begin(summaryRoom, randomUUID(), "최근 7일 공복 혈당 기록 요약");
  const savedSummary = await finish(summaryAttempt, summaryAnswer);
  assert.deepEqual(savedSummary.turns[0].answer, summaryAnswer);
  assert.deepEqual((await db.query("select answer from public.assistant_turns where conversation_id=$1", [summaryRoom.id])).rows[0].answer, summaryAnswer);
  assert.deepEqual(await create(summaryRoom.id), savedSummary);
  passed("saved summary survives a fresh database read and room lookup with its original timestamp and statistics");
  await db.exec("reset role");
  await rejects("table CHECK uses the upgraded validator and rejects invalid saved summary even for direct writes",
    () => db.query("update public.assistant_turns set answer=$1::jsonb where conversation_id=$2", [JSON.stringify(invalidSummaries[0]), summaryRoom.id]), "23514");
  await identity(b);
  assert.deepEqual((await db.query("select answer from public.assistant_turns where conversation_id=$1", [summaryRoom.id])).rows, []);
  await rejects("another account cannot overwrite a saved summary even with its attempt ID", () => finish(summaryAttempt, summaryAnswer), "P0002");
  await remove(summaryRoom.id);
  await identity(a);
  assert.deepEqual((await db.query("select answer from public.assistant_turns where conversation_id=$1", [summaryRoom.id])).rows[0].answer, summaryAnswer);
  passed("summary owner isolation preserves the snapshot after another account attempts deletion");
  await remove(summaryRoom.id);
  assert.equal((await db.query("select count(*)::int n from public.assistant_turns where conversation_id=$1", [summaryRoom.id])).rows[0].n, 0);
  passed("deleting a room also deletes its saved fasting summary");
  for (const [label,changes] of [
    ["missing turn UUID",{id:undefined}], ["invalid turn UUID",{id:"bad"}], ["question too long",{question:"가".repeat(1001)}],
    ["empty question",{question:" \n\t "}], ["question wrong type",{question:42}], ["spoofed owner",{user_id:b}],
    ["spoofed answer",{answer}], ["missing version",{expected_updated_at:undefined}], ["infinite version",{expected_updated_at:"infinity"}],
  ]) await rejects(label,()=>begin(first,randomUUID(),"질문",changes),"23514");
  const turnId = randomUUID();
  const pending = await begin(first,turnId,"  당화혈색소란 무엇인가요?  ");
  assert.equal(pending.alreadyCompleted,false); assert.equal(pending.room.turns[0].status,"pending");
  assert.equal(pending.room.title,"당화혈색소란 무엇인가요?");
  assert.equal(pending.room.turns[0].question,"당화혈색소란 무엇인가요?");
  assert.equal("attempt_id" in pending.room.turns[0],false);
  passed("pending saved before generation with bounded title and private attempt");
  await rejects("attempt token cannot be read directly",()=>db.query("select attempt_id from public.assistant_turns"),"42501");
  await rejects("raw turn update denied",()=>db.query("update public.assistant_turns set answer=null"),"42501");
  await rejects("fresh pending cannot duplicate model work",()=>begin(pending.room,turnId),"PT423");
  await rejects("new turn cannot race an active turn",()=>begin(pending.room),"PT423");
  await rejects("same request ID cannot change question",()=>begin(pending.room,turnId,"다른 질문"),"PT409");
  await rejects("stale room version rejected",()=>begin(first),"PT409");
  const invalidAnswers = [null,{}, {...answer, answer:""}, {...answer,answer:"a".repeat(12001)}, {...answer,kind:"invented"},
    {...answer,user_id:b},{...answer,citations:[{...answer.citations[0],url:"javascript:alert(1)"}]},
    {...answer,citations:[{...answer.citations[0],url:"https://user:password@example.invalid"}]},
    {...answer,citations:[{...answer.citations[0],pdfPages:[-1]}]},
    {...answer,citations:[{...answer.citations[0],attribution:{}}]},
    {...answer,citations:[{...answer.citations[0],retrievedAt:"2026-02-30T00:00:00Z"}]},
    {...answer,citations:[answer.citations[0],answer.citations[0]]},
  ];
  for (let index=0;index<invalidAnswers.length;index++) await rejects(`invalid stored answer ${index+1}`,()=>finish(pending,invalidAnswers[index]),"23514");
  const complete = await finish(pending);
  assert.deepEqual(complete.turns[0].answer,answer); assert.equal(complete.turns[0].status,"completed");
  assert.equal(complete.turns.length,1); assert.notEqual(complete.updated_at,pending.room.updated_at);
  passed("finish stores the answer and advances version atomically");
  assert.deepEqual(await finish(pending,{...answer,answer:"cannot overwrite"}),complete);
  passed("lost finish response replay cannot overwrite the winning answer");
  const replay = await begin(first,turnId);
  assert.equal(replay.alreadyCompleted,true); assert.deepEqual(replay.room,complete);
  passed("lost begin response replays a completed matching question without new turn");
  await identity(b);
  assert.deepEqual((await db.query("select id,question,answer from public.assistant_turns")).rows,[]);
  passed("turn RLS hides other account question and answer");
  await rejects("other account cannot finish even with known attempt",()=>finish(pending),"P0002");
  await identity(a);
  const failAttempt = await begin(complete);
  const failed = await finish(failAttempt,null,"답변을 받지 못했어요. 다시 시도해 주세요.");
  assert.equal(failed.turns.at(-1).status,"failed");
  const retry = await begin(failed,failed.turns.at(-1).id);
  assert.notEqual(retry.attemptId,failAttempt.attemptId); assert.equal(retry.room.turns.length,2);
  await rejects("failed attempt cannot overwrite its retry",()=>finish(failAttempt),"PT409");
  const retried = await finish(retry); passed("failed retries keep the question ID and replace only their attempt");
  const staleAttempt = await begin(retried);
  await db.exec("reset role");
  await db.query("update public.assistant_turns set updated_at=clock_timestamp()-interval '181 seconds' where conversation_id=$1 and id=$2",[staleAttempt.room.id,staleAttempt.room.turns.at(-1).id]);
  await identity(a);
  const staleRetry = await begin(staleAttempt.room,staleAttempt.room.turns.at(-1).id);
  assert.notEqual(staleRetry.attemptId,staleAttempt.attemptId);
  await rejects("abandoned generation cannot replace stale retry",()=>finish(staleAttempt),"PT409");
  let current = await finish(staleRetry); passed("pending older than 180 seconds can be retried without duplicate turn");
  const olderFailure = await begin(current); current=await finish(olderFailure,null,"다시 시도해 주세요.");
  const newer = await begin(current); current=await finish(newer);
  await rejects("older failed question cannot change newer context",()=>begin(current,olderFailure.room.turns.at(-1).id),"PT409");
  const deletePending = await begin(current);
  await remove(first.id); await remove(first.id);
  assert.equal((await db.query("select count(id)::int n from public.assistant_turns")).rows[0].n,0);
  passed("room deletion cascades through every turn and is idempotent");
  await rejects("late answer cannot restore deleted room",()=>finish(deletePending),"P0002");
  const recreated = await create(first.id); const recreatedPending=await begin(recreated,deletePending.room.turns.at(-1).id);
  await rejects("late answer cannot overwrite recreated room with matching IDs",()=>finish(deletePending),"PT409");
  await finish(recreatedPending);
  await db.exec("reset role"); await db.query("update public.user_consents set policy_version='old' where user_id=$1",[a]);
  await identity(a);
  assert.equal((await stored(first.id)).length,1); passed("outdated consent still permits reading existing conversations");
  await rejects("outdated consent blocks create",()=>create(),"42501");
  await rejects("outdated consent blocks new turn",()=>begin(recreated),"42501");
  await rejects("outdated consent blocks finishing",()=>finish(recreatedPending),"42501");
  await remove(first.id); passed("outdated consent still permits deleting conversations");
  await db.exec("reset role"); await db.query("update public.user_consents set policy_version='demo-v3' where user_id=$1",[a]);
  await identity(a);
  const rooms=[]; for(let index=0;index<50;index++) rooms.push(await create());
  await rejects("account is limited to 50 rooms",()=>create(),"PT429");
  assert.deepEqual(await create(rooms[0].id),rooms[0]); passed("idempotent room replay works at the limit");
  let full=rooms[0];
  for(let index=0;index<100;index++) full=await finish(await begin(full,randomUUID(),`질문 ${index+1}`));
  assert.equal(full.turns.length,100); assert.equal(full.title,"질문 1");
  await rejects("room is limited to 100 questions",()=>begin(full),"PT429");
  const fullReplay=await begin(full,full.turns[0].id,full.turns[0].question);
  assert.equal(fullReplay.alreadyCompleted,true); passed("completed replay works at the turn limit");
  const compete=rooms[1];
  const outcomes=await Promise.allSettled([begin(compete,randomUUID(),"첫 질문"),begin(compete,randomUUID(),"둘째 질문")]);
  assert.equal(outcomes.filter(result=>result.status==="fulfilled").length,1);
  passed("competing expected versions have one winner");
  const summaryWinner = outcomes.find(result => result.status === "fulfilled").value;
  await finish(summaryWinner, summaryAnswer);
  assert.equal((await db.query("select count(*)::int n from public.assistant_turns where answer->>'kind'='record_summary'")).rows[0].n, 1);
  passed("account deletion fixture includes a persisted fasting summary");
  await db.exec("reset role"); await db.query("delete from auth.users where id=$1",[a]);
  assert.deepEqual((await db.query("select user_id from public.assistant_conversations")).rows.map(row=>row.user_id),[b]);
  assert.equal((await db.query("select count(*)::int n from public.assistant_turns")).rows[0].n,0);
  passed("account deletion cascades rooms and turns while retaining the other account");
  await identity(a); await rejects("deleted account cannot recreate through RPC",()=>create(),"42501");
  await identity(b); assert.equal((await stored(second.id)).length,1); passed("other account still reads its room");
  console.log(`PASS: ${count} isolated SQL assistant conversation checks.`);
  console.log("Not covered: hosted Supabase Auth/PostgREST or simultaneous transactions on independent database connections.");
} finally { await db.close(); }
