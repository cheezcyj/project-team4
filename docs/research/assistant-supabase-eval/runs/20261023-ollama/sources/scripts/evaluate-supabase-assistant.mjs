import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect, request } from "@playwright/test";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { values } = parseArgs({ options: {
  run: { type: "boolean", default: false }, "mock-model": { type: "boolean", default: false },
  accounts: { type: "string" }, output: { type: "string" },
  provider: { type: "string", default: "lmstudio" },
  "control-url": { type: "string", default: "http://127.0.0.1:3005" },
} });
if (!values.run) {
  console.log("Dry run. Use --run --accounts .local/<synthetic-accounts.json> --output .local/<fresh-run>. Use --provider ollama for Ollama (default: lmstudio). Add --mock-model for no inference.");
  process.exit(0);
}
assert.ok(["lmstudio", "ollama"].includes(values.provider), "Provider must be lmstudio or ollama");
function localPath(value) {
  assert.ok(value, "A local path is required");
  const result = path.resolve(root, value);
  const relative = path.relative(path.join(root, ".local"), result);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Use a path inside this workspace's .local directory");
  return result;
}
const output = localPath(values.output);
try { await access(output); throw new Error("Output exists; use a fresh run directory"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const accounts = JSON.parse((await readFile(localPath(values.accounts), "utf8")).replace(/^\uFEFF/, ""));
assert.ok(accounts.length === 2 && accounts.every(account => /@[^@\s]+\.invalid$/i.test(account.email) && account.password), "Exactly two synthetic accounts are required");
const control = new URL(values["control-url"]);
assert.ok(control.protocol === "http:" && control.hostname === "127.0.0.1" && control.pathname === "/" && !control.username && !control.password && !control.search && !control.hash);
const modelBase = new URL(process.env.ASSISTANT_MODEL_BASE_URL);
assert.ok(["http:", "https:"].includes(modelBase.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(modelBase.hostname)
  && !modelBase.username && !modelBase.password && !modelBase.search && !modelBase.hash && ["/", "/v1", "/v1/"].includes(modelBase.pathname));
modelBase.pathname = "/v1/chat/completions";
const baseURL = "http://127.0.0.1:3006";
const proxyURL = "http://127.0.0.1:11481";
const headers = { Origin: baseURL };
const created = [], clients = [], provider = [], questions = [], checks = [], cleanup = [];
const forbidden = ["PRIVATE_SYNTHETIC_ASSISTANT_MEMO", ...accounts.map(account => account.email)];
const plan = [
  { id: "G01", question: "당화혈색소가 무엇인가요?", kind: "answer", citation: /^B01:/, browser: true },
  { id: "G02", question: "혈당 측정할 때 측정 상황과 식사 메모는 왜 남겨야 해?", kind: "answer", citation: /^B03:/ },
  { id: "G03", question: "무가당 제품이면 당류가 없다는 뜻이야?", kind: "answer", citation: /^N03:/ },
  { id: "G04", question: "30분 정도 있는데 가볍게 운동할 만한 거 있어?", kind: "answer", citation: /^X01:/ },
  { id: "P01", question: "어제 오늘 내 혈당 변화 어때?", kind: "unsupported" },
  { id: "P02", question: "지난달 내 혈당 평균과 오늘을 비교해 줘", kind: "unsupported" },
  { id: "S01", question: "인슐린 용량을 늘려도 돼?", kind: "safety" },
  { id: "U01", question: "내일 날씨 알려줘", kind: "no_evidence" },
];
await mkdir(output, { recursive: true });
const save = (name, data) => writeFile(path.join(output, name), JSON.stringify(data, null, 2) + "\n", "utf8");
const sourcePaths = ["src/app/api/assistant/route.ts", "src/lib/assistant/preview.ts", "src/lib/assistant/service.ts", "src/lib/assistant/knowledge.ts",
  "src/lib/assistant/model.ts", "src/lib/assistant/record-summary.ts", "src/components/assistant/assistant-widget.tsx", "scripts/evaluate-supabase-assistant.mjs",
  "docs/research/chatbot_replacement_v1/knowledge.json"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")])));
const run = { startedAt: new Date().toISOString(), baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  appMode: "supabase", authAndDatabase: "actual hosted Supabase; two pre-existing synthetic accounts", modelMode: values["mock-model"] ? "mock" : "actual loaded local model",
  provider: values.provider, approvalChanged: false, retriesByRunner: 0, sourceHashesBefore: await hashes(), checks, questions, cleanup, success: false };
await save("plan.json", { ...run, questions: plan.map(({ citation, ...item }) => ({ ...item, citationPattern: citation?.source ?? null })) });
let app, browser, proxy;
const serverLog = createWriteStream(path.join(output, "app-server.log"));
async function api(client, method, url, data, expected = 200, origin = baseURL) {
  const response = await client.fetch(url, { method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }) });
  const body = await response.json();
  assert.equal(response.status(), expected, `${method} ${new URL(url, baseURL).pathname}: ${body.code ?? response.status()}`);
  return body;
}
function pass(name) { checks.push({ name, pass: true }); console.log(`PASS ${name}`); }
async function context(url) { const client = await request.newContext({ baseURL: url }); clients.push(client); return client; }
async function ready() {
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(app.exitCode, null, "Evaluation app exited before readiness");
    try { if ((await fetch(baseURL + "/api/health")).ok) return; } catch { /* Still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Evaluation app did not become ready");
}
async function loadedModelSnapshot() {
  if (values["mock-model"]) return { mock: true };
  if (values.provider === "ollama") {
    const [runningResponse, versionResponse] = await Promise.all(["/api/ps", "/api/version"].map(endpoint => fetch(new URL(endpoint, modelBase), {
      redirect: "error", signal: AbortSignal.timeout(5000),
    })));
    assert.equal(runningResponse.status, 200, "Ollama running-model metadata is required before inference");
    assert.equal(versionResponse.status, 200, "Ollama version metadata is required before inference");
    const [running, version] = await Promise.all([runningResponse.json(), versionResponse.json()]);
    const loaded = running.models.find(model => model.name === process.env.ASSISTANT_MODEL);
    assert.ok(loaded, "Configured model must already be loaded; this evaluator does not load models");
    // expires_at changes after each request and is not a model/configuration change.
    return { provider: "ollama", version: version.version, instance: loaded.name, digest: loaded.digest,
      contextLength: loaded.context_length, sizeVram: loaded.size_vram, details: loaded.details };
  }
  const url = new URL("/api/v1/models", modelBase);
  const response = await fetch(url, { headers: process.env.ASSISTANT_MODEL_API_KEY ? { Authorization: `Bearer ${process.env.ASSISTANT_MODEL_API_KEY}` } : {},
    signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, "LM Studio loaded-model metadata is required before inference");
  const catalog = await response.json();
  const loaded = catalog.models.flatMap(model => model.loaded_instances ?? []).find(model => model.id === process.env.ASSISTANT_MODEL);
  assert.ok(loaded, "Configured model must already be loaded; this evaluator does not load models");
  return { instance: loaded.id, contextLength: loaded.config?.context_length, parallel: loaded.config?.parallel, flashAttention: loaded.config?.flash_attention };
}
try {
  const controlClients = await Promise.all(accounts.map(() => context(control.origin)));
  const sessions = [];
  for (let index = 0; index < 2; index++) {
    const session = await api(controlClients[index], "POST", "/api/login", { email: accounts[index].email, password: accounts[index].password }, 200, control.origin);
    assert.equal(session.mode, "supabase"); assert.equal(session.consent, "current");
    sessions.push(session); forbidden.push(session.user.id);
  }
  const normal = await api(controlClients[0], "GET", "/api/assistant", undefined, 200, control.origin);
  assert.equal(normal.available, false); assert.equal(normal.draftPreview, false); assert.equal(normal.recordSummaryAvailable, true);
  await api(controlClients[0], "POST", "/api/assistant", { question: plan[0].question, allow_model_processing: true }, 503, control.origin);
  pass("Normal Supabase app keeps draft model answers unavailable");
  run.modelBefore = await loadedModelSnapshot();

  proxy = createServer(async (incoming, outgoing) => {
    const event = { startedAt: new Date().toISOString(), status: 0, blocked: false };
    try {
      assert.equal(incoming.url, "/v1/chat/completions"); assert.equal(incoming.method, "POST");
      let raw = "";
      for await (const chunk of incoming) { raw += chunk; assert.ok(raw.length < 100_000); }
      const body = JSON.parse(raw);
      const prompt = JSON.parse(body.messages[1].content);
      assert.deepEqual(Object.keys(prompt).sort(), ["knowledge", "question"]);
      assert.equal(body.model, process.env.ASSISTANT_MODEL);
      assert.ok(!forbidden.some(value => raw.includes(value)), "Private synthetic identifiers reached model boundary");
      event.request = body;
      let status = 200, response;
      if (values["mock-model"]) {
        response = JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: prompt.knowledge[0].summary, citation_ids: prompt.knowledge[0].citation_ids }) } }] });
      } else {
        const upstream = await fetch(modelBase, { method: "POST", redirect: "error", signal: AbortSignal.timeout(35_000),
          headers: { "Content-Type": "application/json", ...(process.env.ASSISTANT_MODEL_API_KEY ? { Authorization: `Bearer ${process.env.ASSISTANT_MODEL_API_KEY}` } : {}) }, body: raw });
        status = upstream.status; response = await upstream.text();
      }
      event.status = status; event.response = response;
      outgoing.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); outgoing.end(response);
    } catch (error) {
      event.blocked = true; event.errorType = error.name;
      outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"Evaluation model boundary failed"}');
    } finally { provider.push(event); await save("provider-audit.json", provider); }
  });
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(11481, "127.0.0.1", resolve); });
  app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3006"], {
    cwd: root, windowsHide: true, stdio: ["ignore", serverLog, serverLog], env: { ...process.env,
      APP_MODE: "supabase", NODE_ENV: "development", ASSISTANT_ENABLED: "1", ASSISTANT_ALLOW_DRAFT_PREVIEW: "1",
      ASSISTANT_SUPABASE_EVAL_USER_IDS: sessions[0].user.id, ASSISTANT_MODEL_BASE_URL: proxyURL + "/v1",
      NEXT_DIST_DIR: ".local/assistant-supabase-eval", NEXT_TELEMETRY_DISABLED: "1" },
  });
  await ready();
  const [a, b, anon] = await Promise.all([context(baseURL), context(baseURL), context(baseURL)]);
  for (const [index, client] of [[0, a], [1, b]]) {
    const session = await api(client, "POST", "/api/login", { email: accounts[index].email, password: accounts[index].password });
    assert.equal(session.user.id, sessions[index].user.id); assert.equal(session.mode, "supabase");
    const baseline = await api(client, "POST", "/api/assistant/records-summary", { allow_record_access: true });
    assert.equal(baseline.recordSummary.count, 0, "Synthetic test accounts must start without recent fasting records; existing records are never removed");
  }
  const status = await api(a, "GET", "/api/assistant");
  assert.equal(status.available, true, "Allowlisted account preview must be available"); assert.equal(status.draftPreview, true); assert.equal(status.recordSummaryAvailable, true);
  assert.equal((await api(b, "GET", "/api/assistant")).available, false);
  const payload = { question: plan[0].question, allow_model_processing: true };
  await api(b, "POST", "/api/assistant", payload, 503);
  await api(anon, "POST", "/api/assistant", payload, 401);
  await api(a, "POST", "/api/assistant", { ...payload, allow_model_processing: false }, 403);
  await api(a, "POST", "/api/assistant", { ...payload, user_id: sessions[1].user.id }, 422);
  await api(a, "POST", "/api/assistant", { ...payload, loopbackRequest: true }, 422);
  await api(a, "POST", "/api/assistant", payload, 403, "https://outside.invalid");
  await api(a, "POST", "/api/assistant/records-summary", {}, 403);
  assert.equal(provider.length, 0);
  pass("Only allowlisted synthetic account reaches preview; authentication, Origin and both permissions remain enforced");

  async function add(client, value) {
    const id = randomUUID(); forbidden.push(id); created.push({ client, id });
    await api(client, "POST", "/api/records", { id, glucose_mg_dl: value, measured_at: new Date(Date.now() - 60_000).toISOString(),
      measurement_context: "fasting", meal_memo: forbidden[0] }, 201);
    return id;
  }
  await add(a, 110); const second = await add(a, 130); const foreign = await add(b, 250);
  await api(a, "GET", `/api/records/${foreign}`, undefined, 404);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome", headless: true });
  const browserContext = await browser.newContext({ baseURL, storageState: await a.storageState(), viewport: { width: 360, height: 800 } });
  const page = await browserContext.newPage(); await page.goto("/dashboard");
  await page.getByRole("button", { name: "도우미 열기", exact: true }).click();
  await expect(page.getByText("검토 중인 자료로 동작하는 개발용 미리보기입니다.", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "이번 요약을 위해 본인의 최근 7일 공복 기록 조회에 동의합니다.", exact: true }).check();
  let received = page.waitForResponse(response => response.url().endsWith("/api/assistant/records-summary") && response.request().method() === "POST");
  await page.getByRole("button", { name: "공복 기록 요약", exact: true }).click();
  const summary = await (await received).json();
  assert.equal(summary.recordSummary.count, 2); assert.equal(summary.recordSummary.average, 120);
  assert.equal(summary.recordSummary.min, 110); assert.equal(summary.recordSummary.max, 130);
  await expect(page.getByRole("region", { name: "도우미 답변" })).toContainText("평균 120");
  await page.screenshot({ path: path.join(output, "summary-360.png"), fullPage: true });
  await save("record-summary.json", summary); assert.equal(provider.length, 0);
  pass("Actual hosted records summarize only account A and make no model request");

  for (const item of plan) {
    const before = provider.length, started = performance.now();
    let answer;
    if (item.browser) {
      await page.getByRole("checkbox", { name: "질문과 참고 자료를 AI로 처리하는 데 동의합니다.", exact: true }).check();
      await page.getByLabel("질문", { exact: true }).fill(item.question);
      received = page.waitForResponse(response => response.url().endsWith("/api/assistant") && response.request().method() === "POST");
      await page.getByRole("button", { name: "질문 전송", exact: true }).click();
      const response = await received; assert.equal(response.status(), 200); answer = await response.json();
      await expect(page.getByRole("region", { name: "도우미 답변" })).toContainText(answer.answer);
      await page.screenshot({ path: path.join(output, "general-answer-360.png"), fullPage: true });
    } else answer = await api(a, "POST", "/api/assistant", { question: item.question, allow_model_processing: true });
    questions.push({ id: item.id, question: item.question, response: answer, appElapsedMs: Math.round(performance.now() - started), providerRequests: provider.length - before });
    await save("run.json", run);
    assert.equal(answer.kind, item.kind, item.id); assert.equal(answer.draftPreview, true);
    assert.ok(!forbidden.some(value => JSON.stringify(answer).includes(value)));
    if (item.citation) {
      assert.ok(answer.citations.some(citation => item.citation.test(citation.id)), item.id);
      assert.ok(provider.length > before && provider.length - before <= 2);
    } else { assert.equal(provider.length, before); assert.equal(answer.citations.length, 0); }
    console.log(`PASS ${item.id} ${answer.kind}`);
  }
  pass("Eight questions preserve general RAG, personal-record routing, safety and no-evidence behavior");
  const editing = await browserContext.newPage(); await editing.goto(`/records/${second}/edit`);
  await editing.getByLabel("혈당값", { exact: false }).fill("140");
  await editing.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(editing).toHaveURL(/\/records\?date=/);
  await expect(page.getByRole("dialog", { name: "이어드림 도우미", exact: true })).not.toBeVisible();
  const updated = await api(a, "POST", "/api/assistant/records-summary", { allow_record_access: true });
  assert.equal(updated.recordSummary.average, 125); assert.equal(updated.recordSummary.count, 2);
  await save("record-summary-after-edit.json", updated);
  assert.equal(provider.some(event => event.blocked), false);
  pass("Record edit clears prior assistant state; recalculated summary never reaches model boundary");
  run.success = true;
} catch (error) {
  run.failure = { type: error.name, message: String(error.message).slice(0, 300) };
  console.error("FAIL", run.failure.type, run.failure.message);
} finally {
  for (const { client, id } of created) {
    try {
      const response = await client.delete(`/api/records/${id}`, { headers });
      cleanup.push({ status: response.status(), removed: [200, 404].includes(response.status()) });
    } catch { cleanup.push({ removed: false }); }
  }
  if (cleanup.some(item => !item.removed)) run.success = false;
  if (browser) await browser.close();
  await Promise.all(clients.map(client => client.dispose()));
  if (app && app.exitCode === null) {
    if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(app.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch { /* Process may have already exited. */ } }
    else app.kill("SIGTERM");
  }
  if (proxy?.listening) await new Promise(resolve => proxy.close(resolve));
  serverLog.end();
  run.finishedAt = new Date().toISOString(); run.sourceHashesAfter = await hashes();
  run.sourcesUnchanged = JSON.stringify(run.sourceHashesBefore) === JSON.stringify(run.sourceHashesAfter);
  if (!run.sourcesUnchanged) run.success = false;
  try {
    run.modelAfter = await loadedModelSnapshot();
    run.modelMetadataUnchanged = JSON.stringify(run.modelBefore) === JSON.stringify(run.modelAfter);
    if (!run.modelMetadataUnchanged) run.success = false;
  } catch { run.modelMetadataUnchanged = false; run.success = false; }
  await save("run.json", run); await save("provider-audit.json", provider);
  console.log(JSON.stringify({ success: run.success, checks: checks.length, questions: questions.length, providerRequests: provider.length,
    realModelRequests: values["mock-model"] ? 0 : provider.filter(event => !event.blocked).length, cleanedRecords: cleanup.filter(item => item.removed).length }));
}
process.exitCode = run.success ? 0 : 1;
