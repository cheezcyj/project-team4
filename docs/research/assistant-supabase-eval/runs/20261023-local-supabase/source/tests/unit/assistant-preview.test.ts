import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackAssistantRequest } from "../../src/lib/assistant/preview";
import { answerQuestion, assistantStatus } from "../../src/lib/assistant/service";
import { ApiError } from "../../src/lib/server/errors";
import type { RequestContext } from "../../src/lib/server/session";

const id = "11111111-1111-4111-8111-111111111111";
const context: RequestContext = { session: { mode: "supabase", consent: "current", user: { id, email: "synthetic@example.invalid" } } };
const env = { NODE_ENV: "development", ASSISTANT_ENABLED: "1", ASSISTANT_ALLOW_DRAFT_PREVIEW: "1",
  ASSISTANT_SUPABASE_EVAL_USER_IDS: id, ASSISTANT_MODEL: "mock-model", ASSISTANT_MODEL_BASE_URL: "http://127.0.0.1:9999/v1" };
const options = { loopbackRequest: true };

test("Supabase draft evaluation requires every local-development, synthetic-identity and consent gate", () => {
  assert.deepEqual(assistantStatus(context, env, options).draftPreview, true);
  const denied = [
    { env: { ...env, NODE_ENV: "production" } }, { env: { ...env, NODE_ENV: "test" } },
    { env: { ...env, ASSISTANT_ALLOW_DRAFT_PREVIEW: "0" } }, { env: { ...env, ASSISTANT_SUPABASE_EVAL_USER_IDS: "" } },
    { env: { ...env, ASSISTANT_SUPABASE_EVAL_USER_IDS: "*" } },
    { env: { ...env, ASSISTANT_SUPABASE_EVAL_USER_IDS: "22222222-2222-4222-8222-222222222222" } },
    { context: { session: { ...context.session, consent: "missing" as const } } },
    { context: { session: { ...context.session, user: { id, email: "person@example.com" } } } },
    { options: {} },
  ];
  for (const item of denied) {
    const status = assistantStatus(item.context ?? context, item.env ?? env, item.options ?? options);
    assert.equal(status.available, false);
    assert.equal(status.draftPreview, false);
  }
  assert.throws(() => assistantStatus({ session: { ...context.session, user: null } }, env, options),
    (error: unknown) => error instanceof ApiError && error.code === "UNAUTHORIZED");
});

test("loopback evaluation rejects public URLs, mismatched Host, cross-site calls and spoofed forwarding headers", () => {
  const check = (url: string, headers: Record<string, string>) => isLoopbackAssistantRequest(new Request(url, { headers }));
  assert.equal(check("http://127.0.0.1:3006/api/assistant", { host: "127.0.0.1:3006" }), true);
  assert.equal(check("http://localhost:3006/api/assistant", { host: "localhost:3006", origin: "http://localhost:3006" }), true);
  assert.equal(check("http://localhost:3006/api/assistant", { host: "127.0.0.1:3006", origin: "http://127.0.0.1:3006" }), true);
  assert.equal(check("http://[::1]:3006/api/assistant", { host: "[::1]:3006" }), true);
  for (const [url, headers] of [
    ["https://public.example/api/assistant", { host: "public.example", "x-forwarded-host": "127.0.0.1:3006" }],
    ["http://127.0.0.1:3006/api/assistant", { host: "public.example" }],
    ["http://localhost:3006/api/assistant", { host: "127.0.0.1:3007" }],
    ["http://127.0.0.1:3006/api/assistant", { host: "127.0.0.1:3006", origin: "https://public.example" }],
    ["http://127.0.0.1:3006/api/assistant", { host: "127.0.0.1:3006", "sec-fetch-site": "cross-site" }],
  ] as [string, Record<string, string>][]) assert.equal(check(url, headers), false);
});

test("local evaluation preserves input consent and scope checks; prompts exclude account identifiers", async () => {
  const question = { question: "당화혈색소가 무엇인가요?", allow_model_processing: true };
  const callOptions = { env, ...options, fetch: async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    assert.ok(!body.includes(id)); assert.ok(!body.includes(context.session.user!.email));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "검사에 관한 일반 설명이에요.", citation_ids: ["B01:R1"] }) } }] });
  } };
  assert.equal((await answerQuestion(context, question, callOptions)).draftPreview, true);
  for (const [body, code] of [
    [{ ...question, allow_model_processing: false }, "AI_CONSENT_REQUIRED"],
    [{ ...question, loopbackRequest: true }, "INVALID_INPUT"],
    [{ ...question, user_id: id }, "INVALID_INPUT"],
  ] as [Record<string, unknown>, string][]) {
    await assert.rejects(answerQuestion(context, body, callOptions), (error: unknown) => error instanceof ApiError && error.code === code);
  }
  const personal = await answerQuestion(context, { ...question, question: "어제 오늘 내 혈당 변화 어때?" },
    { ...callOptions, fetch: async () => { throw new Error("Personal record questions must not call a model"); } });
  assert.equal(personal.kind, "unsupported");
  assert.ok(personal.answer.includes("공복 기록 요약"));
});
