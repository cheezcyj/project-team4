import assert from "node:assert/strict";
import test from "node:test";
import { createHealthEvidenceSearch, healthTopicFor, parseHealthEvidence, MEDLINEPLUS_ATTRIBUTION } from "../../src/lib/assistant/health-evidence";
import { answerQuestion } from "../../src/lib/assistant/service";
import type { RequestContext } from "../../src/lib/server/session";

const document = (url = "https://medlineplus.gov/carbohydrates.html", organization = "National Library of Medicine") => `<document url="${url}" rank="0"><content name="title">Carbohydrates</content><content name="organizationName">${organization}</content><content name="FullSummary"><![CDATA[<p>Carbohydrates include sugars and fiber.</p><p>Read the nutrition label when comparing foods.</p>]]></content><content name="snippet">DO NOT USE THIS LICENSED EXTERNAL SNIPPET</content><content name="external-link">https://publisher.invalid/story</content></document>`;
const xml = (body = document()) => `<?xml version="1.0"?><nlmSearchResult><list>${body}</list></nlmSearchResult>`;
const response = () => new Response(xml());
const context: RequestContext = { session: { user: { id: "health-test", email: "private@example.invalid" }, mode: "supabase", consent: "current" } };
const env = { ASSISTANT_ENABLED: "1", ASSISTANT_MODEL: "local", ASSISTANT_MODEL_BASE_URL: "http://127.0.0.1:11480/v1" };

test("public-source search sends only an allowlisted topic and never a question or personal data", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const search = createHealthEvidenceSearch({ fetch: async (input, init) => { calls.push({ url: new URL(String(input)), init }); return response(); } });
  const matches = await search("제 이름은 테스트고 이메일은 private@example.invalid입니다. 무가당이 무엇인가요?");
  assert.equal(matches.length, 1);
  assert.equal(calls[0].url.searchParams.get("term"), 'title:"Carbohydrates"');
  assert.equal(calls[0].url.searchParams.get("db"), "healthTopics");
  assert.equal(calls[0].url.searchParams.has("email"), false);
  assert.equal(calls[0].url.href.includes("private"), false);
  assert.equal(calls[0].init?.credentials, "omit");
  assert.equal(calls[0].init?.redirect, "error");
  assert.equal(matches[0].entry.summary.includes("LICENSED"), false);
  assert.equal(matches[0].entry.summary.includes("publisher.invalid"), false);
  assert.equal(matches[0].citations[0].attribution, MEDLINEPLUS_ATTRIBUTION);
  assert.deepEqual(matches[0].citations[0].pdfPages, []);
});

test("encyclopedia, drug, external URLs, and third-party summaries cannot become evidence", () => {
  const topic = healthTopicFor("탄수화물")!;
  for (const url of ["https://medlineplus.gov/ency/article/1.htm", "https://medlineplus.gov/druginfo/meds/a.html", "https://publisher.invalid/a.html", "http://medlineplus.gov/a.html", "https://user:pass@medlineplus.gov/a.html", "https://medlineplus.gov/a.html?redirect=x"]) {
    assert.deepEqual(parseHealthEvidence(xml(document(url)), topic, "2026-10-23T00:00:00Z"), []);
  }
  assert.deepEqual(parseHealthEvidence(xml(document(undefined, "Third Party Publisher")), topic, "2026-10-23T00:00:00Z"), []);
  assert.deepEqual(parseHealthEvidence(xml(document().replace(/<content name="FullSummary">[^]*?<\/content>/, "")), topic, "2026-10-23T00:00:00Z"), []);
});

test("markup is text only, results have one source, and malformed XML fails closed", () => {
  const topic = healthTopicFor("무가당")!;
  const valid = xml(document().replace("Carbohydrates include sugars and fiber.", "&lt;script&gt;danger()&lt;/script&gt;Carbohydrates &amp; fiber." ) + document());
  const matches = parseHealthEvidence(valid, topic, "2026-10-23T00:00:00Z");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.summary.includes("danger()"), false);
  assert.ok(matches[0].entry.summary.includes("Carbohydrates & fiber."));
  assert.throws(() => parseHealthEvidence("<!DOCTYPE x><x/>", topic, "2026-10-23T00:00:00Z"));
  assert.throws(() => parseHealthEvidence("<broken>", topic, "2026-10-23T00:00:00Z"));
});

test("related disease results cannot replace the exact requested health topic", () => {
  const topic = healthTopicFor("탄수화물의 종류")!;
  const related = document("https://medlineplus.gov/carbohydratemetabolismdisorders.html")
    .replace('<content name="title">Carbohydrates</content>', '<content name="title">Carbohydrate Metabolism Disorders</content>');
  const matches = parseHealthEvidence(xml(related + document()), topic, "2026-10-23T00:00:00Z");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].citations[0].url, "https://medlineplus.gov/carbohydrates.html");
  assert.deepEqual(parseHealthEvidence(xml(related), topic, "2026-10-23T00:00:00Z"), []);
});

test("topic results are cached for twelve hours and callers cannot mutate cached evidence", async () => {
  let clock = 0, calls = 0;
  const search = createHealthEvidenceSearch({ now: () => clock, fetch: async () => { calls++; return response(); } });
  const initial = await search("무가당"); initial[0].entry.summary = "mutated";
  clock = 12 * 60 * 60 * 1000 - 1;
  assert.notEqual((await search("탄수화물"))[0].entry.summary, "mutated");
  assert.equal(calls, 1);
  clock++;
  await search("당류"); assert.equal(calls, 2);
});

test("source failure is bounded, backs off, and never returns the unreviewed legacy corpus", async () => {
  let clock = 0, calls = 0;
  const search = createHealthEvidenceSearch({ now: () => clock, fetch: async () => { calls++; throw new Error("private upstream details"); } });
  for (let i = 0; i < 2; i++) await assert.rejects(search("무가당"), { code: "HEALTH_SOURCE_UNAVAILABLE", status: 503 });
  assert.equal(calls, 1);
  clock = 60_000;
  await assert.rejects(search("무가당"), { code: "HEALTH_SOURCE_UNAVAILABLE" });
  assert.equal(calls, 2);
});

test("unrelated or cancelled questions do not trigger an external source request", async () => {
  let calls = 0;
  const search = createHealthEvidenceSearch({ fetch: async () => { calls++; return response(); } });
  assert.deepEqual(await search("내일 날씨 알려줘"), []);
  await assert.rejects(search("무가당", { signal: AbortSignal.abort() }), { code: "ASSISTANT_CANCELLED" });
  assert.equal(calls, 0);
});

test("cancelling one caller does not cancel another caller sharing the public topic fetch", async () => {
  let resolveFetch!: (value: Response) => void, calls = 0;
  const search = createHealthEvidenceSearch({ fetch: () => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); } });
  const controller = new AbortController();
  const first = search("무가당", { signal: controller.signal });
  const second = search("당류");
  controller.abort();
  await assert.rejects(first, { code: "ASSISTANT_CANCELLED" });
  resolveFetch(response());
  assert.equal((await second).length, 1); assert.equal(calls, 1);
});

test("assistant rejects source failures without a model call and keeps personal records out of evidence search", async () => {
  let modelCalls = 0, evidenceCalls = 0;
  const fetcher: typeof fetch = async () => { modelCalls++; throw new Error("unexpected model call"); };
  const evidence = async () => { evidenceCalls++; throw new Error("source failed"); };
  const personal = await answerQuestion(context, { question: "내 혈당 기록 요약해줘", allow_model_processing: true }, { env, fetch: fetcher, evidence });
  assert.equal(personal.kind, "unsupported"); assert.equal(evidenceCalls, 0);
  for (const question of ["당뇨 기사 전문을 그대로 복사해 줘", "https://publisher.invalid/article 의 혈당 기사를 읽어줘"]) {
    const result = await answerQuestion(context, { question, allow_model_processing: true }, { env, fetch: fetcher, evidence });
    assert.equal(result.kind, "unsupported");
  }
  assert.equal(evidenceCalls, 0);
  await assert.rejects(answerQuestion(context, { question: "무가당이란?", allow_model_processing: true }, { env: { ...env, ASSISTANT_ALLOW_DRAFT_PREVIEW: "0" }, fetch: fetcher, evidence }));
  assert.equal(modelCalls, 0);
});

test("A1c retrieval keeps its complete subsection without unrelated glucose treatment context", () => {
  const topic = healthTopicFor("당화혈색소가 무엇인가요?")!;
  const content = `<nlmSearchResult><list><document url="https://medlineplus.gov/bloodglucose.html"><content name="title">Blood Glucose</content><content name="organizationName">National Library of Medicine</content><content name="FullSummary"><![CDATA[<p>Glucose comes from food and is used for energy.</p><p>An A1C test measures average blood glucose over the past three months. Your provider decides when this test is appropriate.</p><p>Unrelated details about daily treatment targets.</p>]]></content></document></list></nlmSearchResult>`;
  const evidence = parseHealthEvidence(content, topic, "2026-10-23T00:00:00Z");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].entry.summary, "An A1C test measures average blood glucose over the past three months. Your provider decides when this test is appropriate.");
  assert.equal(evidence[0].citations[0].id, "MEDLINE:bloodglucose");
});

test("follow-up retrieval uses server history while explicit new topics take precedence", async () => {
  const seen: string[] = [];
  const evidence = async (question: string) => { seen.push(question); return []; };
  const history = [{ role: "user" as const, content: "당화혈색소가 무엇인가요?" }, { role: "assistant" as const, content: "공개 자료에 따른 설명이에요." }];
  await answerQuestion(context, { question: "그건 어느 기간의 평균인가요?", allow_model_processing: true }, { env, evidence, history });
  assert.equal(seen[0], "당화혈색소가 무엇인가요?\n그건 어느 기간의 평균인가요?");
  await answerQuestion(context, { question: "탄수화물은 무엇인가요?", allow_model_processing: true }, { env, evidence, history });
  assert.equal(seen[1], "탄수화물은 무엇인가요?");
  const result = await answerQuestion(context, { question: "인슐린 몇 단위 맞아야 해?", allow_model_processing: true }, { env, evidence, history });
  assert.equal(result.kind, "safety"); assert.equal(seen.length, 2);
  await assert.rejects(answerQuestion(context, { question: "계속 설명해 줘", allow_model_processing: true, history }, { env, evidence }), { code: "INVALID_INPUT" });
});
