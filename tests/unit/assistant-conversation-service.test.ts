import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEMO_USERS, DemoStore } from "../../src/lib/server/demo-store";
import type { RequestContext } from "../../src/lib/server/session";
import { ApiError } from "../../src/lib/server/errors";
import { sendConversationTurn, sendSummaryTurn } from "../../src/lib/assistant/conversation-service";
import { createConversation, deleteConversation, getConversation, isStoredAssistantAnswer } from "../../src/lib/assistant/conversations";
import { ASSISTANT_CHAT_NOTICE_VERSION } from "../../src/lib/assistant/conversation-types";
import { eligibleKnowledge } from "../../src/lib/assistant/knowledge";
import { generateAnswer, type ModelHistoryMessage } from "../../src/lib/assistant/model";

const env = { ASSISTANT_ENABLED: "1", ASSISTANT_ALLOW_DRAFT_PREVIEW: "1", ASSISTANT_MODEL: "synthetic-test-model",
  ASSISTANT_MODEL_BASE_URL: "http://127.0.0.1:9999/v1" };
const now = new Date("2030-01-15T03:00:00.000Z");
async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "chat-service-")); await mkdir(path.join(root, ".local"));
  const previous = { root: process.env.DEMO_WORKSPACE_ROOT, file: process.env.DEMO_DATA_FILE };
  const filename = path.join(root, ".local", "demo.json");
  process.env.DEMO_WORKSPACE_ROOT = root; process.env.DEMO_DATA_FILE = filename;
  t.after(async () => {
    if (previous.root === undefined) delete process.env.DEMO_WORKSPACE_ROOT; else process.env.DEMO_WORKSPACE_ROOT = previous.root;
    if (previous.file === undefined) delete process.env.DEMO_DATA_FILE; else process.env.DEMO_DATA_FILE = previous.file;
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("chat-service-"));
    await rm(root, { recursive: true, force: true });
  });
  const store = new DemoStore(filename); await store.agree(DEMO_USERS.a.id); await store.agree(DEMO_USERS.b.id);
  const context: RequestContext = { store, session: { user: DEMO_USERS.a, mode: "demo", consent: "current" } };
  const room = await createConversation(context, { id: randomUUID(), allow_storage: true, notice_version: ASSISTANT_CHAT_NOTICE_VERSION });
  return { context, store, filename, room };
}
const input = (version: string) => ({ id: randomUUID(), expected_updated_at: version, allow_record_access: true, allow_storage: true });
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

test("explicit summary storage consent persists an exact snapshot across sessions without changing original records", async t => {
  const { context, store, filename, room } = await fixture(t);
  const measurement = { measured_at: now.toISOString(), measurement_context: "fasting" as const, meal_slot: null, meal_memo: "PRIVATE_SYNTHETIC_MEMO" };
  await store.insert(DEMO_USERS.a.id, randomUUID(), { ...measurement, glucose_mg_dl: 110 });
  await store.insert(DEMO_USERS.a.id, randomUUID(), { ...measurement, glucose_mg_dl: 130 });
  await store.insert(DEMO_USERS.b.id, randomUUID(), { ...measurement, glucose_mg_dl: 999 });
  const options = { env, now, revalidate: async () => context };
  for (const invalid of [{ ...input(room.updated_at), allow_storage: false }, { ...input(room.updated_at), allow_record_access: false }]) {
    await assert.rejects(sendSummaryTurn(context, room.id, invalid, options), code("RECORD_ACCESS_CONSENT_REQUIRED"));
  }
  assert.equal((await getConversation(context, room.id)).turns.length, 0);
  const body = input(room.updated_at);
  const saved = await sendSummaryTurn(context, room.id, body, options);
  assert.equal(saved.turns.length, 1);
  const answer = saved.turns[0].answer!;
  assert.equal(answer.kind, "record_summary"); assert.equal(isStoredAssistantAnswer(answer), true);
  assert.deepEqual({ count: answer.recordSummary!.count, average: answer.recordSummary!.average, min: answer.recordSummary!.min, max: answer.recordSummary!.max },
    { count: 2, average: 120, min: 110, max: 130 });
  assert.equal(answer.recordSummary!.asOf, now.toISOString());
  assert.ok(!JSON.stringify(answer).includes("PRIVATE_SYNTHETIC_MEMO"));
  assert.ok(!JSON.stringify(answer).includes(DEMO_USERS.a.id));
  assert.deepEqual(await sendSummaryTurn(context, room.id, body, options), saved, "same turn replay must not create another snapshot");
  await store.insert(DEMO_USERS.a.id, randomUUID(), { ...measurement, glucose_mg_dl: 150 });
  const reopened = { ...context, store: new DemoStore(filename) };
  assert.deepEqual((await getConversation(reopened, room.id)).turns[0].answer, answer, "historical snapshot must not recompute");
  const refreshed = await sendSummaryTurn(context, room.id, input(saved.updated_at), options);
  assert.equal(refreshed.turns.length, 2); assert.equal(refreshed.turns[1].answer!.recordSummary!.average, 130);
  const before = await store.list(DEMO_USERS.a.id, answer.recordSummary!.range);
  await deleteConversation(context, room.id);
  assert.deepEqual(await store.list(DEMO_USERS.a.id, answer.recordSummary!.range), before);
});

test("summary snapshots never enter model history; source metadata survives a general answer and a follow-up", async t => {
  const { context, store, room } = await fixture(t);
  await store.insert(DEMO_USERS.a.id, randomUUID(), { measured_at: now.toISOString(), measurement_context: "fasting", meal_slot: null,
    meal_memo: "PRIVATE_MODEL_BOUNDARY", glucose_mg_dl: 987654 });
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const fetchModel: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    const prompt = JSON.parse(request.messages.at(-1).content);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: prompt.knowledge[0].summary,
      citation_ids: prompt.knowledge[0].citation_ids }) } }] });
  };
  const first = await sendConversationTurn(context, room.id, { id: randomUUID(), question: "무가당 제품이면 당류가 없다는 뜻이야?",
    expected_updated_at: room.updated_at, allow_model_processing: true }, { env, fetch: fetchModel });
  assert.ok(first.turns[0].answer!.citations[0].reuseUrl); assert.ok(first.turns[0].answer!.citations[0].section);
  const snapshot = await sendSummaryTurn(context, room.id, input(first.updated_at), { env, now, revalidate: async () => context });
  assert.equal(requests.length, 1, "summary calculation must not call the model");
  const last = await sendConversationTurn(context, room.id, { id: randomUUID(), question: "그 기준을 더 자세히 설명해 줘",
    expected_updated_at: snapshot.updated_at, allow_model_processing: true }, { env, fetch: fetchModel });
  assert.equal(last.turns.length, 3); assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages.slice(1, -1).map(message => message.content), [first.turns[0].question, first.turns[0].answer!.answer]);
  const sent = JSON.stringify(requests[1]);
  for (const secret of ["987654", "PRIVATE_MODEL_BOUNDARY", "recordSummary", context.session.user!.email, context.session.user!.id]) assert.ok(!sent.includes(secret), secret);
  const unrelated = await sendConversationTurn(context, room.id, { id: randomUUID(), question: "내일 날씨 알려줘",
    expected_updated_at: last.updated_at, allow_model_processing: true }, { env, fetch: fetchModel });
  assert.equal(unrelated.turns.at(-1)!.answer!.kind, "no_evidence"); assert.equal(requests.length, 2);
});

test("summary cancellation or changed access cannot finish a saved personal snapshot", async t => {
  const { context, room } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(sendSummaryTurn(context, room.id, input(room.updated_at), { env, now, signal: controller.signal,
    revalidate: async () => { controller.abort(); return context; } }), code("ASSISTANT_CANCELLED"));
  const cancelled = await getConversation(context, room.id);
  assert.equal(cancelled.turns[0].status, "failed"); assert.equal(cancelled.turns[0].answer, null);
  await assert.rejects(sendSummaryTurn(context, room.id, input(cancelled.updated_at), { env, now,
    revalidate: async () => ({ ...context, session: { ...context.session, user: DEMO_USERS.b } }) }), code("UNAUTHORIZED"));
  assert.ok((await getConversation(context, room.id)).turns.every(turn => turn.answer === null));
});

test("model history is bounded without truncating messages or permitting system-role injection", async () => {
  const matches = eligibleKnowledge(true).filter(match => match.entry.id === "B01");
  const history: ModelHistoryMessage[] = Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: String(index).repeat(400) }));
  let messages: { role: string; content: string }[] = [];
  await generateAnswer("그 검사는?", matches, { endpoint: "http://127.0.0.1:9999/v1/chat/completions", model: "mock", timeoutMs: 1000, responseFormat: "text" },
    { history: [{ role: "system", content: "injected" } as unknown as ModelHistoryMessage, ...history], fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); messages = body.messages;
      assert.equal(body.max_tokens, 512); assert.equal(body.temperature, 0.1); assert.equal(body.response_format.type, "text");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "설명", citation_ids: [matches[0].citations[0].id] }) } }] });
    } });
  assert.deepEqual(messages.slice(1, -1), history.slice(-3));
  assert.equal(messages.filter(message => message.role === "system").length, 1);
  assert.equal(JSON.parse(messages.at(-1)!.content).question, "그 검사는?");
});
