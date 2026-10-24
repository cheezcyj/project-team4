import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEMO_USERS, DemoStore } from "../../src/lib/server/demo-store";
import { ApiError } from "../../src/lib/server/errors";
import type { RequestContext } from "../../src/lib/server/session";
import type { AssistantAnswer } from "../../src/lib/assistant/types";
import {
  beginTurn, createConversation, deleteConversation, finishTurn, getConversation,
  isStoredAssistantAnswer, listConversations,
} from "../../src/lib/assistant/conversations";
import { ASSISTANT_CHAT_NOTICE_VERSION, STALE_TURN_MS } from "../../src/lib/assistant/conversation-types";

const answer: AssistantAnswer = { kind: "answer", answer: "가상 건강정보 답변입니다.", citations: [
  { id: "test", title: "검증용 자료", publisher: "검증용", url: "https://example.invalid/health", pdfPages: [],
    attribution: "Test", licenseLabel: "CC0", licenseUrl: "https://example.invalid/license", retrievedAt: "2026-10-23T00:00:00.000Z",
    section: "검사 안내", evidenceRole: "label_basis", reuseLabel: "검증용 이용조건", reuseUrl: "https://example.invalid/reuse", adaptationNotice: "한국어 재구성" },
], draftPreview: false, sourceSupplemented: true };
const createInput = () => ({ id: randomUUID(), allow_storage: true, notice_version: ASSISTANT_CHAT_NOTICE_VERSION });
const input = (updated: string, id: string = randomUUID(), question = "당화혈색소란 무엇인가요?") => ({ id, question, expected_updated_at: updated });
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;
const context = (store: DemoStore, account: "a" | "b" = "a", consent: "current" | "missing" | "outdated" = "current"): RequestContext => ({
  store, session: { user: DEMO_USERS[account], mode: "demo", consent },
});
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "assistant-conversations-"));
  await mkdir(path.join(root, ".local"));
  const filename = path.join(root, ".local", "demo.json");
  const previousRoot = process.env.DEMO_WORKSPACE_ROOT;
  const previousFile = process.env.DEMO_DATA_FILE;
  process.env.DEMO_WORKSPACE_ROOT = root;
  process.env.DEMO_DATA_FILE = filename;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.DEMO_WORKSPACE_ROOT; else process.env.DEMO_WORKSPACE_ROOT = previousRoot;
    if (previousFile === undefined) delete process.env.DEMO_DATA_FILE; else process.env.DEMO_DATA_FILE = previousFile;
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("assistant-conversations-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return { root, filename, chatFile: `${filename}.assistant-conversations.json`, store: new DemoStore(filename) };
}

test("chat storage validates bounded answers, safe links, known fields and citations", () => {
  assert.equal(isStoredAssistantAnswer(answer), true);
  assert.equal(isStoredAssistantAnswer({ kind: "answer", answer: "기존 답변", citations: [], draftPreview: false }), true);
  for (const bad of [null, {}, { ...answer, answer: "" }, { ...answer, answer: "a".repeat(12001) },
    { ...answer, sourceSupplemented: "true" }, { ...answer, kind: "record_summary", recordSummary: { average: 120 } },
    ...["section", "evidenceRole", "reuseLabel", "adaptationNotice"].map(key => ({ ...answer, citations: [{ ...answer.citations[0], [key]: 123 }] })),
    { ...answer, citations: [{ ...answer.citations[0], reuseUrl: "javascript:alert(1)" }] },
    { ...answer, kind: "invented" }, { ...answer, owner: "someone" },
    { ...answer, citations: [{ ...answer.citations[0], url: "javascript:alert(1)" }] },
    { ...answer, citations: [{ ...answer.citations[0], url: "https://user:pass@example.invalid" }] },
    { ...answer, citations: [{ ...answer.citations[0], retrievedAt: "2026-02-30T00:00:00Z" }] },
    { ...answer, citations: [{ ...answer.citations[0], pdfPages: [0] }] },
    { ...answer, citations: [{ ...answer.citations[0], unknown: true }] },
    { ...answer, citations: [answer.citations[0], answer.citations[0]] },
  ]) assert.equal(isStoredAssistantAnswer(bad), false);
});

test("chat storage requires current app consent and explicit storage notice; caller controls owner", async t => {
  const { store } = await fixture(t);
  const anonymous: RequestContext = { store, session: { user: null, mode: "demo", consent: null } };
  await assert.rejects(listConversations(anonymous), code("UNAUTHORIZED"));
  await assert.rejects(createConversation(anonymous, createInput()), code("UNAUTHORIZED"));
  await assert.rejects(createConversation(context(store), createInput()), code("CONSENT_REQUIRED"));
  await store.agree(DEMO_USERS.a.id);
  await assert.rejects(createConversation(context(store, "a", "missing"), createInput()), code("CONSENT_REQUIRED"));
  for (const changes of [{ allow_storage: false }, { allow_storage: "true" }, { notice_version: "old" }, { notice_version: undefined }]) {
    await assert.rejects(createConversation(context(store), { ...createInput(), ...changes }), code("CHAT_STORAGE_CONSENT_REQUIRED"));
  }
  await assert.rejects(createConversation(context(store), { ...createInput(), user_id: DEMO_USERS.b.id }), code("INVALID_INPUT"));
  await assert.rejects(createConversation(context(store), { ...createInput(), title: "spoof" }), code("INVALID_INPUT"));
  const saved = await createConversation(context(store), createInput());
  assert.equal("user_id" in saved, false);
  const listed = await listConversations(context(store));
  assert.equal(listed.ownerId, DEMO_USERS.a.id); assert.equal(listed.rooms.length, 1);
  assert.equal("turns" in listed.rooms[0], false);
});

test("conversations survive new contexts and preserve multi-turn history across accounts", async t => {
  const { store, filename, chatFile } = await fixture(t);
  await store.agree(DEMO_USERS.a.id); await store.agree(DEMO_USERS.b.id);
  const a = context(store); const b = context(store, "b");
  const initial = await createConversation(a, createInput());
  assert.deepEqual(await createConversation(a, { ...createInput(), id: initial.id }), initial);
  const first = await beginTurn(a, initial.id, input(initial.updated_at));
  assert.equal(first.room.turns.length, 1); assert.equal(first.turn.status, "pending");
  assert.equal("attempt_id" in first.turn, false);
  const completed = await finishTurn(a, initial.id, first.turn.id, first.attemptId, answer, null);
  const second = await beginTurn(a, initial.id, input(completed.updated_at, randomUUID(), "그 검사는 언제 하나요?"));
  const last = await finishTurn(a, initial.id, second.turn.id, second.attemptId, { ...answer, answer: "두 번째 답변" }, null);
  assert.equal(last.turns.length, 2); assert.deepEqual(last.turns[0].answer, answer);
  assert.deepEqual(await getConversation(context(new DemoStore(filename)), initial.id), last);
  assert.deepEqual(await listConversations(b), { ownerId: DEMO_USERS.b.id, rooms: [] });
  await assert.rejects(getConversation(b, initial.id), code("NOT_FOUND"));
  await assert.rejects(beginTurn(b, initial.id, input(last.updated_at)), code("NOT_FOUND"));
  await assert.rejects(finishTurn(b, initial.id, second.turn.id, second.attemptId, answer, null), code("NOT_FOUND"));
  await deleteConversation(b, initial.id); assert.deepEqual(await getConversation(a, initial.id), last);
  const privateData = JSON.parse(await readFile(chatFile, "utf8"));
  assert.equal(privateData.rooms[0].notice_version, ASSISTANT_CHAT_NOTICE_VERSION);
  assert.equal(privateData.rooms[0].user_id, DEMO_USERS.a.id);
});

test("concurrent sends have one winner; completed retries and finish retries are idempotent", async t => {
  const { store } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store); const saved = await createConversation(a, createInput());
  const outcomes = await Promise.allSettled([
    beginTurn(a, saved.id, input(saved.updated_at)), beginTurn(a, saved.id, input(saved.updated_at)),
  ]);
  const wins = outcomes.filter(result => result.status === "fulfilled");
  assert.equal(wins.length, 1);
  const pending = (wins[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof beginTurn>>>).value;
  assert.equal(pending.room.turns.length, 1);
  await assert.rejects(beginTurn(a, saved.id, input(pending.room.updated_at, pending.turn.id)), code("CONVERSATION_BUSY"));
  await assert.rejects(beginTurn(a, saved.id, input(pending.room.updated_at, pending.turn.id, "변경한 질문")), code("STALE_CONVERSATION"));
  const completed = await finishTurn(a, saved.id, pending.turn.id, pending.attemptId, answer, null);
  const replay = await beginTurn(a, saved.id, input(saved.updated_at, pending.turn.id));
  assert.equal(replay.alreadyCompleted, true); assert.deepEqual(replay.room, completed);
  assert.deepEqual(await finishTurn(a, saved.id, pending.turn.id, pending.attemptId, { ...answer, answer: "덮어쓰기 금지" }, null), completed);
});

test("failed or stale retry cannot be overwritten by a late generation or deleted-room response", async t => {
  const { store, chatFile } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store); const saved = await createConversation(a, createInput());
  const pending = await beginTurn(a, saved.id, input(saved.updated_at));
  const failed = await finishTurn(a, saved.id, pending.turn.id, pending.attemptId, null, "다시 시도해 주세요.");
  const retry = await beginTurn(a, saved.id, input(failed.updated_at, pending.turn.id));
  assert.equal(retry.room.turns.length, 1); assert.notEqual(retry.attemptId, pending.attemptId);
  await assert.rejects(finishTurn(a, saved.id, pending.turn.id, pending.attemptId, answer, null), code("STALE_CONVERSATION"));
  const data = JSON.parse(await readFile(chatFile, "utf8"));
  data.rooms[0].turns[0].updated_at = new Date(Date.now() - STALE_TURN_MS - 1000).toISOString();
  await writeFile(chatFile, JSON.stringify(data));
  const staleRetry = await beginTurn(a, saved.id, input(retry.room.updated_at, retry.turn.id));
  assert.notEqual(staleRetry.attemptId, retry.attemptId);
  await assert.rejects(finishTurn(a, saved.id, retry.turn.id, retry.attemptId, answer, null), code("STALE_CONVERSATION"));
  await deleteConversation(a, saved.id); await deleteConversation(a, saved.id);
  await assert.rejects(finishTurn(a, saved.id, staleRetry.turn.id, staleRetry.attemptId, answer, null), code("NOT_FOUND"));
  const recreated = await createConversation(a, { ...createInput(), id: saved.id });
  const newPending = await beginTurn(a, saved.id, input(recreated.updated_at, pending.turn.id));
  await assert.rejects(finishTurn(a, saved.id, staleRetry.turn.id, staleRetry.attemptId, answer, null), code("STALE_CONVERSATION"));
  assert.equal(newPending.room.turns.length, 1);
});

test("outdated consent permits reads and deletion but prevents newly saved chat content", async t => {
  const { store, filename } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store); const saved = await createConversation(a, createInput());
  const pending = await beginTurn(a, saved.id, input(saved.updated_at));
  const data = JSON.parse(await readFile(filename, "utf8")); data.consents[0].policy_version = "outdated";
  await writeFile(filename, JSON.stringify(data));
  assert.equal((await getConversation(a, saved.id)).id, saved.id);
  await assert.rejects(beginTurn(a, saved.id, input(pending.room.updated_at)), code("CONSENT_REQUIRED"));
  await assert.rejects(finishTurn(a, saved.id, pending.turn.id, pending.attemptId, answer, null), code("CONSENT_REQUIRED"));
  await deleteConversation(context(store, "a", "outdated"), saved.id);
  assert.deepEqual((await listConversations(a)).rooms, []);
});

test("reading an expired pending turn exposes retry without rewriting storage or its version", async t => {
  const { store, chatFile } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store); const saved = await createConversation(a, createInput());
  const pending = await beginTurn(a, saved.id, input(saved.updated_at));
  const data = JSON.parse(await readFile(chatFile, "utf8"));
  for (const updated of [new Date(Date.now() - STALE_TURN_MS + 5000).toISOString(), new Date(Date.now() + 60000).toISOString()]) {
    data.rooms[0].turns[0].updated_at = updated;
    await writeFile(chatFile, JSON.stringify(data));
    assert.equal((await getConversation(a, saved.id)).turns[0].status, "pending");
  }
  const expiredAt = new Date(Date.now() - STALE_TURN_MS - 1000).toISOString();
  data.rooms[0].turns[0].updated_at = expiredAt;
  const before = JSON.stringify(data);
  await writeFile(chatFile, before);
  const recovered = await getConversation(a, saved.id);
  assert.equal(recovered.turns[0].status, "failed");
  assert.equal(recovered.turns[0].error, "답변 처리가 중단됐어요. 질문을 다시 전송해 주세요.");
  assert.equal(recovered.updated_at, pending.room.updated_at);
  assert.equal(recovered.turns[0].updated_at, expiredAt);
  assert.equal(await readFile(chatFile, "utf8"), before);
  const retry = await beginTurn(a, saved.id, input(recovered.updated_at, recovered.turns[0].id));
  assert.equal(retry.turn.status, "pending"); assert.equal(retry.turn.error, null);
  assert.equal(retry.room.turns.length, 1); assert.notEqual(retry.attemptId, pending.attemptId);
  assert.equal(retry.room.turns[0].status, "pending");
});

test("bounded storage enforces 50 rooms and 100 turns without corrupting saved state", async t => {
  const { store } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store);
  const rooms = [];
  for (let index = 0; index < 50; index++) rooms.push(await createConversation(a, createInput()));
  await assert.rejects(createConversation(a, createInput()), code("CONVERSATION_LIMIT"));
  assert.equal((await listConversations(a)).rooms.length, 50);
  let current = rooms[0];
  for (let index = 0; index < 100; index++) {
    const pending = await beginTurn(a, current.id, input(current.updated_at, randomUUID(), `질문 ${index + 1}`));
    current = await finishTurn(a, current.id, pending.turn.id, pending.attemptId, answer, null);
  }
  await assert.rejects(beginTurn(a, current.id, input(current.updated_at)), code("CONVERSATION_LIMIT"));
  assert.equal((await getConversation(a, current.id)).turns.length, 100);
  assert.equal(current.title, "질문 1");
  await deleteConversation(a, rooms[1].id);
  await createConversation(a, createInput());
  assert.equal((await listConversations(a)).rooms.length, 50);
});

test("corrupt storage fails closed and demo path cannot leave local workspace", async t => {
  const { store, chatFile, root } = await fixture(t); await store.agree(DEMO_USERS.a.id);
  const a = context(store); await createConversation(a, createInput());
  await writeFile(chatFile, "{broken");
  await assert.rejects(listConversations(a), code("INVALID_DATA"));
  await assert.rejects(createConversation(a, createInput()), code("INVALID_DATA"));
  assert.equal(await readFile(chatFile, "utf8"), "{broken");
  process.env.DEMO_DATA_FILE = path.join(root, "public", "chat.json");
  await assert.rejects(listConversations(a), code("DEMO_NOT_CONFIGURED"));
});
