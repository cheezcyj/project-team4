import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isTimestamp, isUuid } from "../domain";
import { ApiError, noConsent, notFound, unauthorized } from "../server/errors";
import { databaseError } from "../server/records";
import type { RequestContext } from "../server/session";
import { ASSISTANT_MAX_QUESTION_LENGTH, type AssistantAnswer } from "./types";
import {
  ASSISTANT_CHAT_NOTICE_VERSION, MAX_ROOMS, MAX_TURNS, STALE_TURN_MS,
  type AssistantConversation, type AssistantConversationSummary, type AssistantTurn, type AssistantTurnAttempt,
} from "./conversation-types";

const ROOM_COLUMNS = "id,user_id,title,created_at,updated_at";
const TURN_COLUMNS = "id,user_id,question,answer,status,error,created_at,updated_at";
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, min = 1): value is string =>
  typeof value === "string" && [...value].length >= min && [...value].length <= max && !value.includes("\0");
const keys = (value: Json, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

function validRecordSummary(value: unknown): boolean {
  if (!object(value) || !keys(value, ["range", "asOf", "timezone", "measurementContext", "unit", "count", "recordedDays", "missingDays", "average", "min", "max"])
    || !object(value.range) || !keys(value.range, ["start", "end", "label"])
    || !isTimestamp(value.range.start) || !isTimestamp(value.range.end) || !text(value.range.label, 100)
    || !isTimestamp(value.asOf) || value.timezone !== "Asia/Seoul" || value.measurementContext !== "fasting" || value.unit !== "mg/dL") return false;
  const integer = (item: unknown, min: number, max: number): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= min && item <= max;
  if (Date.parse(value.range.end) - Date.parse(value.range.start) !== 7 * 86_400_000
    || Date.parse(value.asOf) < Date.parse(value.range.start) || Date.parse(value.asOf) >= Date.parse(value.range.end)
    || !integer(value.count, 0, 2147483647) || !integer(value.recordedDays, 0, 7)
    || value.missingDays !== 7 - value.recordedDays) return false;
  if (value.count === 0) return value.recordedDays === 0 && value.average === null && value.min === null && value.max === null;
  return value.recordedDays > 0 && value.recordedDays <= value.count && integer(value.min, 1, 2147483647)
    && integer(value.max, value.min, 2147483647) && typeof value.average === "number" && Number.isFinite(value.average)
    && value.average >= value.min && value.average <= value.max;
}

function owner(context: RequestContext): string {
  if (!context.session.user) unauthorized();
  return context.session.user.id;
}
function invalid(): never { throw new ApiError(422, "INVALID_INPUT", "대화 내용을 확인한 뒤 다시 시도해 주세요."); }
function conflict(): never { throw new ApiError(409, "STALE_CONVERSATION", "다른 화면에서 대화가 바뀌었어요. 최신 대화를 다시 불러와 주세요."); }
function busy(): never { throw new ApiError(409, "CONVERSATION_BUSY", "이 대화의 답변을 작성 중이에요. 답변을 기다린 뒤 질문해 주세요."); }
function limit(kind: "rooms" | "turns"): never {
  throw new ApiError(409, "CONVERSATION_LIMIT", kind === "rooms"
    ? "대화방은 50개까지 저장할 수 있어요. 사용하지 않는 대화방을 삭제해 주세요."
    : "한 대화방에는 질문과 요약을 합계 100개까지 저장할 수 있어요. 새 대화를 시작해 주세요.");
}
function invalidData(): never { throw new ApiError(503, "INVALID_DATA", "대화를 불러오지 못했어요. 다시 확인해 주세요."); }
function dbError(error: { code?: string }, mutation: boolean): never {
  if (["PT409", "40001", "23505"].includes(error.code ?? "")) conflict();
  if (error.code === "PT423") busy();
  if (error.code === "PT429") throw new ApiError(409, "CONVERSATION_LIMIT", "대화 저장 한도에 도달했어요. 대화방 목록을 확인해 주세요.");
  databaseError(error, mutation);
}

function https(value: unknown): boolean {
  if (!text(value, 2048) || !/^https:\/\//i.test(value)) return false;
  try { const url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch { return false; }
}

// Stored answers are rendered later on other devices, so persisted JSON is
// bounded and checked independently of the model and the caller.
export function isStoredAssistantAnswer(value: unknown): value is AssistantAnswer {
  if (!object(value) || !keys(value, ["kind", "answer", "citations", "draftPreview", "sourceSupplemented", "recordSummary"])
    || !["answer", "no_evidence", "unsupported", "safety", "record_summary"].includes(value.kind as string)
    || !text(value.answer, 12000) || typeof value.draftPreview !== "boolean"
    || ("sourceSupplemented" in value && typeof value.sourceSupplemented !== "boolean")
    || !Array.isArray(value.citations) || value.citations.length > 8
    || Buffer.byteLength(JSON.stringify(value), "utf8") > 65536) return false;
  if (value.kind === "record_summary") return value.draftPreview === false && value.citations.length === 0
    && !("sourceSupplemented" in value) && validRecordSummary(value.recordSummary);
  if ("recordSummary" in value) return false;
  const ids = new Set<string>();
  return value.citations.every(citation => {
    if (!object(citation) || !keys(citation, ["id", "title", "publisher", "url", "pdfPages", "attribution", "licenseLabel", "licenseUrl", "retrievedAt",
      "section", "evidenceRole", "reuseLabel", "reuseUrl", "adaptationNotice"])
      || !text(citation.id, 128) || ids.has(citation.id) || !text(citation.title, 500)
      || !text(citation.publisher, 200) || !https(citation.url)
      || !Array.isArray(citation.pdfPages) || citation.pdfPages.length > 24
      || citation.pdfPages.some(page => !Number.isInteger(page) || page < 1 || page > 100000)
      || ("attribution" in citation && !text(citation.attribution, 2000))
      || ("licenseLabel" in citation && !text(citation.licenseLabel, 200))
      || ("licenseUrl" in citation && !https(citation.licenseUrl))
      || ("retrievedAt" in citation && !isTimestamp(citation.retrievedAt))) return false;
    for (const [field, maximum] of [["section", 2000], ["evidenceRole", 100], ["reuseLabel", 200], ["adaptationNotice", 2000]] as const) {
      if (field in citation && !text(citation[field], maximum)) return false;
    }
    if ("reuseUrl" in citation && !https(citation.reuseUrl)) return false;
    ids.add(citation.id);
    return true;
  });
}

function summary(value: unknown, userId: string): AssistantConversationSummary {
  if (!object(value) || value.user_id !== userId || !isUuid(value.id) || !text(value.title, 60)
    || !isTimestamp(value.created_at) || !isTimestamp(value.updated_at)) invalidData();
  return { id: value.id, title: value.title, created_at: value.created_at, updated_at: value.updated_at };
}
function turn(value: unknown, userId: string): AssistantTurn {
  if (!object(value) || value.user_id !== userId || !isUuid(value.id)
    || !text(value.question, ASSISTANT_MAX_QUESTION_LENGTH) || !value.question.trim()
    || !isTimestamp(value.created_at) || !isTimestamp(value.updated_at)
    || !["pending", "completed", "failed"].includes(value.status as string)
    || (value.status === "completed" ? !isStoredAssistantAnswer(value.answer) || value.error !== null
      : value.answer !== null || (value.status === "pending" ? value.error !== null : !text(value.error, 300)))) invalidData();
  // A stopped server cannot finish its pending row. Expose an expired attempt
  // as retryable without changing its persisted state or optimistic version.
  const expired = value.status === "pending" && Date.now() - Date.parse(value.updated_at) >= STALE_TURN_MS;
  return { id: value.id, question: value.question, answer: value.answer as AssistantAnswer | null,
    status: expired ? "failed" : value.status as AssistantTurn["status"],
    error: expired ? "답변 처리가 중단됐어요. 질문을 다시 전송해 주세요." : value.error as string | null,
    created_at: value.created_at, updated_at: value.updated_at };
}
function room(value: unknown, userId: string): AssistantConversation {
  const base = summary(value, userId);
  const data = value as Json;
  const rawTurns = data.turns ?? data.assistant_turns;
  if (!Array.isArray(rawTurns) || rawTurns.length > MAX_TURNS) invalidData();
  const turns = rawTurns.map(value => turn(value, userId));
  if (new Set(turns.map(value => value.id)).size !== turns.length || turns.filter(value => value.status === "pending").length > 1) invalidData();
  turns.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return { ...base, turns };
}

type StoredTurn = AssistantTurn & { user_id: string; attempt_id: string };
type StoredRoom = Omit<AssistantConversation, "turns"> & {
  user_id: string; notice_version: typeof ASSISTANT_CHAT_NOTICE_VERSION; consented_at: string; turns: StoredTurn[];
};
type DemoConversations = { version: 1; clock: string; rooms: StoredRoom[] };
const demoOwners = new Set(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
const registry = globalThis as typeof globalThis & { __assistantConversationQueues?: Map<string, Promise<unknown>> };
registry.__assistantConversationQueues ??= new Map();

function demoFilename(context: RequestContext): string {
  if (!context.store || context.session.mode !== "demo" || !demoOwners.has(owner(context))) unauthorized();
  // Runtime-only local data must not be traced into the standalone server bundle.
  const root = path.resolve(/* turbopackIgnore: true */ process.env.DEMO_WORKSPACE_ROOT || process.cwd());
  const base = path.resolve(/* turbopackIgnore: true */ root, process.env.DEMO_DATA_FILE || path.join(".local", "demo-data.json"));
  const local = path.resolve(/* turbopackIgnore: true */ root, ".local");
  const relative = path.relative(local, base);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(503, "DEMO_NOT_CONFIGURED", "시연 데이터 설정을 확인해 주세요.");
  }
  return `${base}.assistant-conversations.json`;
}
async function demoTransaction<T>(context: RequestContext, write: boolean, consent: boolean, fn: (data: DemoConversations) => T): Promise<T> {
  const filename = demoFilename(context);
  const queues = registry.__assistantConversationQueues!;
  const previous = queues.get(filename) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    if (consent && await context.store!.consent(owner(context)) !== "current") noConsent();
    let data: DemoConversations;
    try { data = JSON.parse(await readFile(filename, "utf8")) as DemoConversations; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") invalidData();
      data = { version: 1, clock: "1970-01-01T00:00:00.000Z", rooms: [] };
    }
    if (!data || data.version !== 1 || !isTimestamp(data.clock) || !Array.isArray(data.rooms)
      || data.rooms.length > MAX_ROOMS * demoOwners.size || data.rooms.some(row => !object(row))
      || new Set(data.rooms.map(row => row.id)).size !== data.rooms.length) invalidData();
    for (const stored of data.rooms) {
      if (!demoOwners.has(stored.user_id) || stored.notice_version !== ASSISTANT_CHAT_NOTICE_VERSION
        || !isTimestamp(stored.consented_at) || data.rooms.filter(row => row.user_id === stored.user_id).length > MAX_ROOMS) invalidData();
      room(stored, stored.user_id);
      if (stored.turns.some(value => !isUuid(value.attempt_id))) invalidData();
    }
    const result = fn(data);
    if (write) {
      await mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(data), { encoding: "utf8", mode: 0o600 }); await rename(temporary, filename); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
    return structuredClone(result);
  });
  queues.set(filename, pending);
  try { return await pending; } finally { if (queues.get(filename) === pending) queues.delete(filename); }
}
function nextTime(data: DemoConversations): string {
  data.clock = new Date(Math.max(Date.now(), Date.parse(data.clock) + 1)).toISOString();
  return data.clock;
}
function findRoom(data: DemoConversations, userId: string, id: string): StoredRoom {
  const saved = data.rooms.find(value => value.id === id && value.user_id === userId);
  if (!saved) notFound();
  return saved;
}

export async function listConversations(context: RequestContext): Promise<{ rooms: AssistantConversationSummary[]; ownerId: string }> {
  const userId = owner(context);
  if (context.store) return demoTransaction(context, false, false, data => ({ ownerId: userId,
    rooms: data.rooms.filter(value => value.user_id === userId).map(value => summary(value, userId))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)) }));
  const result = await context.supabase!.from("assistant_conversations").select(ROOM_COLUMNS)
    .eq("user_id", userId).order("updated_at", { ascending: false }).order("id").limit(MAX_ROOMS + 1);
  if (result.error) dbError(result.error, false);
  if (!result.data || result.data.length > MAX_ROOMS) invalidData();
  return { rooms: result.data.map(value => summary(value, userId)), ownerId: userId };
}

export async function getConversation(context: RequestContext, id: string): Promise<AssistantConversation> {
  const userId = owner(context);
  if (!isUuid(id)) notFound();
  if (context.store) return demoTransaction(context, false, false, data => room(findRoom(data, userId, id), userId));
  const result = await context.supabase!.from("assistant_conversations")
    .select(`${ROOM_COLUMNS},assistant_turns(${TURN_COLUMNS})`).eq("id", id).eq("user_id", userId).maybeSingle();
  if (result.error) dbError(result.error, false);
  if (!result.data) notFound();
  return room(result.data, userId);
}

export async function createConversation(context: RequestContext, body: Record<string, unknown>): Promise<AssistantConversation> {
  const userId = owner(context);
  if (context.session.consent !== "current") noConsent();
  if (!keys(body, ["id", "allow_storage", "notice_version"]) || !isUuid(body.id)) invalid();
  if (body.allow_storage !== true || body.notice_version !== ASSISTANT_CHAT_NOTICE_VERSION) {
    throw new ApiError(403, "CHAT_STORAGE_CONSENT_REQUIRED", "대화를 계정에 저장하는 안내를 확인하고 동의해 주세요.");
  }
  if (context.store) return demoTransaction(context, true, true, data => {
    const existing = data.rooms.find(value => value.id === body.id);
    if (existing) { if (existing.user_id !== userId) notFound(); return room(existing, userId); }
    if (data.rooms.filter(value => value.user_id === userId).length >= MAX_ROOMS) limit("rooms");
    const time = nextTime(data);
    const saved: StoredRoom = { id: body.id as string, user_id: userId, title: "새 대화", created_at: time,
      updated_at: time, notice_version: ASSISTANT_CHAT_NOTICE_VERSION, consented_at: time, turns: [] };
    data.rooms.push(saved);
    return room(saved, userId);
  });
  const result = await context.supabase!.rpc("create_assistant_conversation", { p_input: body });
  if (result.error) dbError(result.error, true);
  return room(result.data, userId);
}

export async function deleteConversation(context: RequestContext, id: string): Promise<void> {
  const userId = owner(context);
  if (!isUuid(id)) notFound();
  if (context.store) return demoTransaction(context, true, false, data => {
    data.rooms = data.rooms.filter(value => value.id !== id || value.user_id !== userId);
  });
  const result = await context.supabase!.rpc("delete_assistant_conversation", { p_id: id });
  if (result.error) dbError(result.error, true);
}

export async function beginTurn(context: RequestContext, id: string, body: Record<string, unknown>): Promise<AssistantTurnAttempt> {
  const userId = owner(context);
  if (context.session.consent !== "current") noConsent();
  if (!isUuid(id)) notFound();
  if (!keys(body, ["id", "question", "expected_updated_at"]) || !isUuid(body.id)
    || !text(body.question, ASSISTANT_MAX_QUESTION_LENGTH) || !body.question.trim() || !isTimestamp(body.expected_updated_at)) invalid();
  const question = body.question.trim();
  if (context.store) return demoTransaction(context, true, true, data => {
    const saved = findRoom(data, userId, id);
    const existing = saved.turns.find(value => value.id === body.id);
    if (existing && existing.question !== question) conflict();
    if (existing?.status === "completed") return { room: room(saved, userId), turn: turn(existing, userId), attemptId: existing.attempt_id, alreadyCompleted: true };
    if (saved.updated_at !== body.expected_updated_at) conflict();
    const pending = saved.turns.find(value => value.status === "pending");
    if (pending && (pending.id !== body.id || Date.now() - Date.parse(pending.updated_at) < STALE_TURN_MS)) busy();
    if (existing && saved.turns.at(-1)?.id !== existing.id) conflict();
    if (!existing && saved.turns.length >= MAX_TURNS) limit("turns");
    const time = nextTime(data);
    const current: StoredTurn = existing ?? { id: body.id as string, user_id: userId, question, answer: null,
      status: "pending", error: null, created_at: time, updated_at: time, attempt_id: randomUUID() };
    if (!existing) saved.turns.push(current);
    current.status = "pending"; current.answer = null; current.error = null; current.updated_at = time; current.attempt_id = randomUUID();
    saved.updated_at = time;
    if (saved.turns.length === 1) saved.title = [...question.replace(/\s+/gu, " ")].slice(0, 60).join("");
    return { room: room(saved, userId), turn: turn(current, userId), attemptId: current.attempt_id, alreadyCompleted: false };
  });
  const result = await context.supabase!.rpc("begin_assistant_turn", { p_room_id: id, p_input: { ...body, question } });
  if (result.error) dbError(result.error, true);
  if (!object(result.data) || !isUuid(result.data.attemptId) || typeof result.data.alreadyCompleted !== "boolean") invalidData();
  const saved = room(result.data.room, userId);
  const current = saved.turns.find(value => value.id === body.id);
  if (!current) invalidData();
  return { room: saved, turn: current, attemptId: result.data.attemptId, alreadyCompleted: result.data.alreadyCompleted };
}

export async function finishTurn(context: RequestContext, roomId: string, turnId: string, attemptId: string,
  answer: AssistantAnswer | null, error: string | null): Promise<AssistantConversation> {
  const userId = owner(context);
  if (context.session.consent !== "current") noConsent();
  if (!isUuid(roomId) || !isUuid(turnId) || !isUuid(attemptId)
    || (answer === null ? !text(error, 300) : !isStoredAssistantAnswer(answer) || error !== null)) invalid();
  if (context.store) return demoTransaction(context, true, true, data => {
    const saved = findRoom(data, userId, roomId);
    const current = saved.turns.find(value => value.id === turnId);
    if (!current) notFound();
    if (current.attempt_id !== attemptId) conflict();
    // Replaying a completed finish can recover from a lost HTTP response, but
    // cannot change the answer that won the first successful transaction.
    if (current.status !== "pending") return room(saved, userId);
    current.answer = answer; current.error = error; current.status = answer ? "completed" : "failed";
    current.updated_at = nextTime(data); saved.updated_at = current.updated_at;
    return room(saved, userId);
  });
  const result = await context.supabase!.rpc("finish_assistant_turn", {
    p_room_id: roomId, p_turn_id: turnId, p_attempt_id: attemptId, p_answer: answer, p_error: error,
  });
  if (result.error) dbError(result.error, true);
  return room(result.data, userId);
}
