import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import bundle from "../../docs/research/chatbot_replacement_v1/knowledge.json";
import { contentHash, eligibleKnowledge, retrieveKnowledge, type KnowledgeBundle } from "../../src/lib/assistant/knowledge";
import { generateAnswer, modelSettings } from "../../src/lib/assistant/model";
import { answerQuestion, assistantStatus } from "../../src/lib/assistant/service";
import { ApiError } from "../../src/lib/server/errors";
import type { RequestContext } from "../../src/lib/server/session";

const context: RequestContext = { session: { user: { id: "assistant-test-user", email: "never-send@example.test" }, mode: "demo", consent: "current" } };
const env = { ASSISTANT_ENABLED: "1", ASSISTANT_ALLOW_DRAFT_PREVIEW: "1", ASSISTANT_MODEL: "test-model", ASSISTANT_MODEL_BASE_URL: "http://127.0.0.1:9999/v1" };
const question = { question: "당화혈색소가 무엇인가요?", allow_model_processing: true };
const hasCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
function completion(answer = "검사에 관한 일반적인 설명입니다.", citationIds = ["B01:R1"]) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer, citation_ids: citationIds }) } }] });
}

test("draft corpus remains blocked by default and in Supabase, with explicit local preview only", () => {
  assert.equal(eligibleKnowledge(false).length, 0);
  assert.equal(eligibleKnowledge(true).length, 13);
  assert.ok(eligibleKnowledge(true).every(match => !["B05", "N05"].includes(match.entry.id)));
  assert.equal(assistantStatus(context, {}).available, false);
  assert.equal(assistantStatus(context, env).available, true);
  assert.equal(assistantStatus({ session: { ...context.session, mode: "supabase" } }, env).available, false);
  assert.equal(bundle.policy.runtime_publishable, false);
  assert.throws(() => assistantStatus({ session: { user: null, mode: "demo", consent: null } }, env), hasCode("UNAUTHORIZED"));
});

test("production eligibility requires approval, current review dates, reuse permission and intact content", () => {
  const approved: KnowledgeBundle = structuredClone(bundle);
  approved.policy.runtime_publishable = true;
  approved.approval = { team_content_approved: true, medical_review_completed: true, source_reuse_review_completed: true };
  for (const source of approved.sources) {
    source.status = "approved"; source.approved_at = "2026-10-01"; source.permitted_runtime_reuse = true;
  }
  for (const entry of approved.knowledge_entries) {
    entry.status = "approved"; entry.approved_at = "2026-10-01"; entry.review_due_at = "2026-11-01";
  }
  const now = Date.parse("2026-10-22");
  assert.equal(eligibleKnowledge(false, now, approved).length, 13);
  approved.knowledge_entries[0].summary += "변조";
  assert.equal(eligibleKnowledge(false, now, approved).some(match => match.entry.id === "B01"), false);
  assert.equal(eligibleKnowledge(false, Date.parse("2026-12-01"), approved).length, 0);
  assert.equal(contentHash(bundle.knowledge_entries[0]), bundle.knowledge_entries[0].content_sha256);
});

test("lexical retrieval selects relevant Korean knowledge and abstains on unrelated or overly broad input", () => {
  const candidates = eligibleKnowledge(true);
  for (const [text, id] of [
    ["당화혈색소가 무엇인가요?", "B01"], ["HbA1c 설명", "B01"], ["식후 2시간은 언제부터인가요?", "B02"],
    ["탄수화물은 먹어도 되나요?", "N02"], ["무가당이라는 뜻은?", "N03"], ["과일 주스는 어떤가요?", "N04"],
    ["실내에서 할 운동", "X02"], ["벽밀기", "X02"], ["팔 들기", "X02"], ["30분 정도 가벼운 운동", "X01"],
  ]) assert.equal(retrieveKnowledge(text, candidates)[0]?.entry.id, id, text);
  assert.equal(retrieveKnowledge("내일 날씨 알려줘", candidates).length, 0);
  assert.equal(retrieveKnowledge("혈당", candidates).length, 0);
});

test("replacement references include web sections, notice clauses and reuse attribution; malformed metadata stays ineligible", () => {
  const candidates = eligibleKnowledge(true);
  assert.deepEqual([...new Set(candidates.flatMap(m => m.citations.map(c => c.id.split(":")[1])))].sort(), ["R1", "R2", "R3", "R4"]);
  for (const match of candidates) {
    assert.equal(contentHash(match.entry), match.entry.content_sha256);
    for (const citation of match.citations) {
      assert.deepEqual(citation.pdfPages, []);
      assert.ok(citation.section && citation.attribution && citation.adaptationNotice && citation.reuseLabel);
      assert.equal(new URL(citation.reuseUrl!).protocol, "https:");
    }
  }
  assert.equal(candidates.find(m => m.entry.id === "N01")!.citations[0].reuseUrl, "https://creativecommons.org/licenses/by/4.0/");
  assert.match(candidates.find(m => m.entry.id === "N03")!.citations[0].section!, /별지 1/u);
  assert.equal(candidates.find(m => m.entry.id === "X05")!.citations[0].evidenceRole, "background_only");
  for (const mutation of [
    (data: KnowledgeBundle) => { data.sources[0].document_type = "unverified"; },
    (data: KnowledgeBundle) => { data.sources[0].reuse_url = "javascript:alert(1)"; },
    (data: KnowledgeBundle) => { data.sources[0].attribution = ""; },
    (data: KnowledgeBundle) => { data.knowledge_entries[0].evidence[0].section = " "; },
    (data: KnowledgeBundle) => { data.knowledge_entries[0].evidence[0].pdf_pages = [9]; },
  ]) {
    const data: KnowledgeBundle = structuredClone(bundle);
    mutation(data);
    data.knowledge_entries[0].content_sha256 = contentHash(data.knowledge_entries[0]);
    assert.equal(eligibleKnowledge(true, Date.now(), data).some(m => m.entry.id === "B01"), false);
  }
});

test("old equipment instructions have no replacement evidence, while the new indoor activity prompt uses only R2", async () => {
  for (const text of ["실내 자전거 운동", "탄력 밴드로 할 수 있는 운동", "실내 자전거와 탄력 밴드는 누구나 안전하게 해도 돼?"]) {
    assert.deepEqual(retrieveKnowledge(text, eligibleKnowledge(true)), [], text);
    const result = await answerQuestion(context, { ...question, question: text }, { env, fetch: async () => { throw new Error("No equipment evidence"); } });
    assert.equal(result.kind, "no_evidence");
  }
  const result = await answerQuestion(context, { ...question, question: "집에서 벽밀기나 팔 들기 같은 운동이 있어?" }, { env, fetch: async (_url, init) => {
    const prompt = JSON.parse(JSON.parse(String(init!.body)).messages[1].content);
    assert.equal(prompt.knowledge[0].title, bundle.knowledge_entries.find(e => e.id === "X02")!.title);
    assert.deepEqual(prompt.knowledge[0].citation_ids, ["X02:R2"]);
    assert.match(prompt.knowledge[0].summary, /벽밀기나 팔 들기/u);
    assert.doesNotMatch(prompt.knowledge[0].summary, /자전거|밴드/u);
    return completion("벽밀기와 팔 들기는 자신에게 맞는지 기존 계획과 전문가 안내를 확인해 주세요.", ["X02:R2"]);
  } });
  assert.equal(result.kind, "answer");
  assert.equal(result.sourceSupplemented, false);
});

test("all 13 replacement questions reach their new evidence through the service without sending original documents", async () => {
  for (const entry of bundle.knowledge_entries) {
    const result = await answerQuestion(context, { ...question, question: entry.title }, { env, fetch: async (_url, init) => {
      const body = String(init!.body);
      const prompt = JSON.parse(JSON.parse(body).messages[1].content);
      const selected = prompt.knowledge.find((item: { citation_ids: string[] }) => item.citation_ids.includes(`${entry.id}:${entry.evidence[0].source_id}`));
      assert.ok(selected, entry.id);
      assert.equal(selected.summary, entry.summary);
      assert.ok(prompt.knowledge.every((item: { citation_ids: string[] }) => item.citation_ids.every(id => /^[BNX]\d\d:R[1-4]$/.test(id))));
      for (const value of ["KDCA_", "KDA_GUIDELINE", "source_sha256", "snapshot", "local_path", context.session.user!.email]) assert.ok(!body.includes(value), value);
      return completion(entry.summary, selected.citation_ids);
    } });
    assert.equal(result.kind, "answer", entry.id);
    assert.equal(result.citations[0].id, `${entry.id}:${entry.evidence[0].source_id}`);
  }
});

test("exercise evidence requires an activity question rather than an incidental keyword", () => {
  const candidates = eligibleKnowledge(true);
  for (const text of [
    "당뇨병 합병증은 뭐가 있어?", "당뇨병 합병증 예방 방법 알려줘", "식전 혈당 수치가 140이 나왔어",
    "혈당 수치가 뭔가요?", "식후 30분에 혈당 재도 돼?", "실내에서 혈당을 측정해도 돼?", "발 상처가 생겼어", "케톤이란 뭐야?",
  ]) assert.deepEqual(retrieveKnowledge(text, candidates), [], text);
  for (const [text, id] of [
    ["30분 산책", "X01"], ["식사 후 걷기는 어때?", "X01"], ["집에서 근력 운동", "X02"],
    ["운동 전후 혈당을 확인하는 이유", "X03"], ["합병증이 있는데 운동 시작 전에 뭘 확인해야 해?", "X04"],
    ["혈당 수치 하나로 운동 가능 여부를 알 수 있어?", "X05"],
  ]) assert.equal(retrieveKnowledge(text, candidates)[0]?.entry.id, id, text);
});

test("model endpoint configuration accepts loopback only and never browser-supplied destinations", () => {
  assert.equal(modelSettings(env)?.endpoint, "http://127.0.0.1:9999/v1/chat/completions");
  assert.equal(modelSettings(env)?.responseFormat, "json_object");
  assert.equal(modelSettings({ ...env, ASSISTANT_MODEL_RESPONSE_FORMAT: "text" })?.responseFormat, "text");
  assert.equal(modelSettings({ ...env, ASSISTANT_MODEL_RESPONSE_FORMAT: "unknown" }), null);
  for (const address of ["https://remote.example/v1", "http://127.0.0.1.evil.test/v1", "http://user:secret@localhost/v1", "http://localhost/v1?token=secret", "file:///v1", "http://localhost/other"]) {
    assert.equal(modelSettings({ ...env, ASSISTANT_MODEL_BASE_URL: address }), null);
  }
});

test("LM Studio text format still requires a JSON answer and validated source identifiers", async () => {
  const textEnv = { ...env, ASSISTANT_MODEL_RESPONSE_FORMAT: "text" };
  const result = await answerQuestion(context, question, { env: textEnv, fetch: async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).response_format, { type: "text" });
    assert.equal(JSON.parse(String(init?.body)).reasoning_effort, "none");
    return completion();
  } });
  assert.equal(result.kind, "answer");
  for (const response of [Response.json({ choices: [{ message: { content: "형식에 맞지 않는 답변" } }] }), completion("출처 오류", ["invented:source"])]) {
    await assert.rejects(answerQuestion(context, question, { env: textEnv, fetch: async () => response }), hasCode("INVALID_MODEL_RESPONSE"));
  }
});

test("only the explicit LM Studio engine transport failure retries once within the original request signal", async () => {
  const engineError = () => Response.json({ error: "Engine protocol predict request failed: fetch failed" }, { status: 400 });
  const requests: { body: unknown; signal: AbortSignal | null | undefined }[] = [];
  const result = await answerQuestion(context, question, { env, fetch: async (_url, init) => {
    requests.push({ body: init?.body, signal: init?.signal });
    return requests.length === 1 ? engineError() : completion();
  } });
  assert.equal(result.kind, "answer");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].signal, requests[1].signal);
  for (const [failure, expectedCalls] of [[engineError, 2], [() => Response.json({ error: "unrelated request error" }, { status: 400 }), 1],
    [() => new Response("private upstream error", { status: 500 }), 1]] as const) {
    let calls = 0;
    await assert.rejects(answerQuestion(context, question, { env, fetch: async () => { calls++; return failure(); } }), hasCode("MODEL_UNAVAILABLE"));
    assert.equal(calls, expectedCalls);
  }
});

test("chat rejects missing AI acknowledgement, empty or oversized questions and extra identity/history fields", async () => {
  for (const body of [{ ...question, allow_model_processing: false }, { question: question.question }]) {
    await assert.rejects(answerQuestion(context, body, { env }), hasCode("AI_CONSENT_REQUIRED"));
  }
  for (const body of [{ ...question, question: " " }, { ...question, question: "가".repeat(1001) }, { ...question, user_id: "another-user" }, { ...question, history: [] }]) {
    await assert.rejects(answerQuestion(context, body, { env }), hasCode("INVALID_INPUT"));
  }
});

test("unsupported personal requests, medical requests and absent evidence do not call the model", async () => {
  const never: typeof fetch = async () => { throw new Error("model must not be called"); };
  for (const [text, kind] of [["어제와 오늘 혈당 변화 어때?", "unsupported"], ["내 혈당 평균 알려줘", "unsupported"],
    ["오늘 점심 뭐 먹을까?", "unsupported"], ["인슐린 몇 단위 맞아야 해?", "safety"], ["내일 날씨 알려줘", "no_evidence"]]) {
    const result = await answerQuestion(context, { ...question, question: text }, { env, fetch: never });
    assert.equal(result.kind, kind); assert.deepEqual(result.citations, []);
  }
});

test("screenshot regressions and measurement variants stop before model processing", async () => {
  let calls = 0;
  const never: typeof fetch = async () => { calls++; throw new Error("model must not be called"); };
  for (const text of [
    "식전 혈당 수치가 140이 나왔어", "식전 혈당 수치가 １４０이 나왔어", "공복 혈당값: 140mg/dL",
    "혈당 측정 결과는 140.5예요", "HbA1c가 7.2% 나왔어", "당화혈색소 수치는 7.2야",
    "혈당 6.5 mmol/L인데 운동해도 돼?", "제 혈당이 140인데 합병증이야?",
  ]) {
    const result = await answerQuestion(context, { ...question, question: text }, { env, fetch: never });
    assert.equal(result.kind, "unsupported", text);
    assert.deepEqual(result.citations, [], text);
    assert.ok(result.answer.includes("수치의 정상 여부"), text);
    assert.ok(!result.answer.includes("운동"), text);
  }
  for (const text of ["당뇨병 합병증은 뭐가 있어?", "식후 30분에 혈당 재도 돼?", "혈당 수치가 뭔가요?", "실내에서 혈당을 측정해도 돼?"]) {
    const result = await answerQuestion(context, { ...question, question: text }, { env, fetch: never });
    assert.equal(result.kind, "no_evidence", text);
    assert.deepEqual(result.citations, [], text);
  }
  const lunch = await answerQuestion(context, { ...question, question: "오늘 점심 뭐 먹어?" }, { env, fetch: never });
  assert.equal(lunch.kind, "unsupported");
  assert.ok(lunch.answer.includes("식단 추천"));
  assert.equal(calls, 0);
});

test("general HbA1c and time questions still reach the model with relevant evidence", async () => {
  const texts = ["당화혈색소가 뭐야", "당화혈색소는 2~3개월 평균이야?", "HbA1c는 2개월 평균을 보여줘?", "식후 2시간은 언제부터인가요?"];
  const sent: string[] = [];
  for (const text of texts) {
    const result = await answerQuestion(context, { ...question, question: text }, { env, fetch: async (_url, init) => {
      const prompt = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      sent.push(prompt.question);
      const isMeasurement = text.startsWith("식후");
      assert.equal(prompt.knowledge[0].topic, isMeasurement ? "measurement" : "basic");
      return completion("자료 범위의 일반 설명입니다.", [prompt.knowledge[0].citation_ids[0]]);
    } });
    assert.equal(result.kind, "answer", text);
    assert.ok(result.citations.length > 0, text);
  }
  assert.deepEqual(sent, texts);
});

test("answer uses server-owned source links and sends only the current question and selected public snippets", async () => {
  let sent = "";
  const result = await answerQuestion(context, question, { env, fetch: async (url, init) => {
    assert.equal(url, "http://127.0.0.1:9999/v1/chat/completions");
    assert.equal(init?.redirect, "error");
    sent = String(init?.body);
    assert.deepEqual(JSON.parse(sent).chat_template_kwargs, { enable_thinking: false });
    const prompt = JSON.parse(JSON.parse(sent).messages[1].content);
    assert.equal(prompt.knowledge[0].title, bundle.knowledge_entries[0].title);
    assert.equal(prompt.knowledge[0].topic, "basic");
    assert.deepEqual(prompt.knowledge[0].citation_ids, ["B01:R1"]);
    assert.equal(prompt.knowledge[0].sources[0].section, bundle.knowledge_entries[0].evidence[0].section);
    assert.equal(prompt.knowledge[0].sources[0].pdf_pages, undefined);
    assert.equal(prompt.knowledge[0].id, undefined);
    return completion();
  } });
  assert.equal(result.kind, "answer"); assert.equal(result.draftPreview, true);
  assert.equal(result.citations[0].url, bundle.sources[0].canonical_url);
  assert.deepEqual(result.citations[0].pdfPages, []);
  assert.equal(result.citations[0].section, bundle.knowledge_entries[0].evidence[0].section);
  assert.equal(result.citations[0].reuseUrl, "https://www.niddk.nih.gov/copyright");
  assert.ok(sent.includes("당화혈색소"));
  for (const excluded of [context.session.user!.email, context.session.user!.id, "local_path", "approved_at", "meal_memo", "glucose_records", "KDCA_", "KDA_GUIDELINE_"]) assert.ok(!sent.includes(excluded), excluded);
});

test("invented citations, malformed output and upstream errors never expose raw model responses", async () => {
  for (const response of [completion("외부 비밀", ["invented:source"]), completion("축약한 식별자", ["B01"]), completion("이전 자료", ["B01:KDCA_DIABETES"]), Response.json({ choices: [] }), completion("https://invented.example", ["B01:R1"])]) {
    await assert.rejects(answerQuestion(context, question, { env, fetch: async () => response }), hasCode("INVALID_MODEL_RESPONSE"));
  }
  await assert.rejects(answerQuestion(context, question, { env, fetch: async () => Response.json({
    choices: [{ finish_reason: "length", message: { content: JSON.stringify({ answer: "잘린 응답", citation_ids: ["B01:R1"] }) } }],
  }) }), hasCode("INVALID_MODEL_RESPONSE"));
  await assert.rejects(answerQuestion(context, question, { env, fetch: async () => new Response("private upstream error", { status: 500 }) }), hasCode("MODEL_UNAVAILABLE"));
  const result = await answerQuestion(context, question, { env, fetch: async () => completion("unsupported claim", []) });
  assert.equal(result.kind, "no_evidence"); assert.ok(!result.answer.includes("unsupported claim"));
});

test("cancelled calls and duplicate in-flight requests release their slot", async () => {
  let release: () => void = () => undefined;
  const started = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const pending = answerQuestion(context, question, { env, signal: controller.signal, fetch: async (_url, init) => {
    release();
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  await started;
  await assert.rejects(answerQuestion(context, question, { env }), hasCode("ASSISTANT_BUSY"));
  controller.abort();
  await assert.rejects(pending, hasCode("ASSISTANT_CANCELLED"));
  assert.equal((await answerQuestion(context, question, { env, fetch: async () => completion() })).kind, "answer");
});

test("model timeout and oversized upstream response fail without exposing upstream content", async () => {
  const settings = { ...modelSettings(env)!, timeoutMs: 5 };
  const matches = retrieveKnowledge(question.question, eligibleKnowledge(true));
  const keepAlive = setTimeout(() => undefined, 1000);
  try {
    await assert.rejects(generateAnswer(question.question, matches, settings, { fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("timeout")), { once: true })) }), hasCode("MODEL_TIMEOUT"));
  } finally { clearTimeout(keepAlive); }
  await assert.rejects(generateAnswer(question.question, matches, modelSettings(env)!, {
    fetch: async () => new Response("private upstream data".repeat(4000)),
  }), hasCode("MODEL_UNAVAILABLE"));
});

test("compatible protocol works through real HTTP to a local mock, without loading any model", async () => {
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.model, "mock-model"); assert.equal(body.messages.length, 2);
    response.setHeader("Content-Type", "application/json");
    response.end(await completion().text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const settings = modelSettings({ ...env, ASSISTANT_MODEL: "mock-model", ASSISTANT_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1` })!;
    const result = await generateAnswer(question.question, retrieveKnowledge(question.question, eligibleKnowledge(true)), settings);
    assert.deepEqual(result.citationIds, ["B01:R1"]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
