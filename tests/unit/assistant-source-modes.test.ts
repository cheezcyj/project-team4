import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, assistantStatus } from "../../src/lib/assistant/service";
import { modelSettings } from "../../src/lib/assistant/model";
import type { RequestContext } from "../../src/lib/server/session";
import type { KnowledgeMatch } from "../../src/lib/assistant/knowledge";

const context: RequestContext = { session: { user: { id: "local-test", email: "local@example.invalid" }, mode: "demo", consent: "current" } };
const env = { ASSISTANT_ENABLED: "1", ASSISTANT_MODEL: "mock", ASSISTANT_MODEL_BASE_URL: "http://127.0.0.1:11480/v1" };
const question = { question: "당화혈색소가 무엇인가요?", allow_model_processing: true };

test("local local preview uses team knowledge without contacting the production source", async () => {
  const result = await answerQuestion(context, question, {
    env: { ...env, ASSISTANT_ALLOW_DRAFT_PREVIEW: "1" },
    evidence: async () => { throw new Error("Preview must not request external evidence"); },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(input.knowledge[0].citation_ids, ["B01:R1"]);
      assert.equal(body.cache_prompt, false);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "자료에 따른 일반 검사 설명이에요.", citation_ids: ["B01:R1"] }) } }] });
    },
  });
  assert.equal(result.kind, "answer");
  assert.equal(result.draftPreview, true);
  assert.equal(result.citations[0].id, "B01:R1");
});

test("local default preserves production evidence and legacy citation metadata", async () => {
  const citation = { id: "MEDLINE:bloodglucose", title: "공개 건강 주제", publisher: "테스트 제공처", url: "https://medlineplus.gov/bloodglucose.html", pdfPages: [], licenseLabel: "공개 건강 주제 요약", licenseUrl: "https://medlineplus.gov/about/using/usingcontent/", attribution: "Source: MedlinePlus, National Library of Medicine" };
  const evidence: KnowledgeMatch[] = [{ entry: { id: citation.id, version: 1, topic: "a1c", language: "en", title: "Blood Glucose", summary: "A synthetic public-source explanation.", keywords: [], conditions: [], content_sha256: "fixture", status: "public-domain-source", approved_at: null, review_due_at: null, evidence: [] }, citations: [citation], score: 1 }];
  let requested = "";
  const result = await answerQuestion(context, question, { env,
    evidence: async input => { requested = input; return evidence; },
    fetch: async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
      assert.deepEqual(input.knowledge[0].citation_ids, [citation.id]);
      assert.ok(!JSON.stringify(input).includes("B01:R1"));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "공개 주제 자료의 일반 설명이에요.", citation_ids: [citation.id] }) } }] });
    },
  });
  assert.equal(requested, question.question);
  assert.equal(result.draftPreview, false);
  assert.deepEqual(result.citations, [citation]);
  assert.equal(assistantStatus(context, env).recordSummaryAvailable, true);
});

test("local retains bounded deployment timeout configuration", () => {
  assert.equal(modelSettings(env)?.timeoutMs, 45_000);
  assert.equal(modelSettings({ ...env, ASSISTANT_MODEL_TIMEOUT_MS: "90000" })?.timeoutMs, 90_000);
  for (const timeout of ["NaN", "0", "999", "90001", "1200.5"]) assert.equal(modelSettings({ ...env, ASSISTANT_MODEL_TIMEOUT_MS: timeout }), null);
});

test("draft-only evaluation can disable public sources without changing the team evaluator", async () => {
  const isolated = { ...env, ASSISTANT_PUBLIC_SOURCES_ENABLED: "0" };
  assert.equal(assistantStatus(context, isolated).available, false);
  await assert.rejects(answerQuestion(context, question, { env: isolated,
    evidence: async () => { throw new Error("External evidence must stay disabled"); },
    fetch: async () => { throw new Error("Model must not be contacted"); },
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "ASSISTANT_UNAVAILABLE");
  assert.equal(assistantStatus(context, { ...isolated, ASSISTANT_ALLOW_DRAFT_PREVIEW: "1" }).draftPreview, true);
});
