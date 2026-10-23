import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { channel } from 'node:diagnostics_channel';

const { values } = parseArgs({ options: { run: { type: 'boolean', default: false },
  'base-url': { type: 'string' }, runtime: { type: 'string' }, model: { type: 'string' }, output: { type: 'string' } } });
if (!values.run) { console.log('Use --run --runtime llama.cpp|ollama --base-url http://127.0.0.1:PORT --output .local/FRESH [--model MODEL]'); process.exit(0); }
assert.ok(['llama.cpp', 'ollama'].includes(values.runtime));
const base = new URL(values['base-url']);
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/');
const output = path.resolve(values.output);
assert.ok(path.relative(path.resolve('.local'), output) && !path.relative(path.resolve('.local'), output).startsWith('..'));
await mkdir(output); // Never overwrite an existing run.
const save = async (name, data) => writeFile(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const endpoint = new URL('/v1/chat/completions', base);
async function get(route) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `Metadata ${route}`); return response.json();
}
let model;
async function snapshot() {
  if (values.runtime === 'llama.cpp') {
    const [health, catalog, props, slots] = await Promise.all([get('/health'), get('/v1/models'), get('/props'), get('/slots')]);
    assert.equal(health.status, 'ok');
    model ??= values.model ?? catalog.data[0]?.id;
    assert.ok(model && catalog.data.some(item => item.id === model));
    const settings = props.default_generation_settings ?? {};
    return { runtime: 'llama.cpp', model, totalSlots: props.total_slots, contextLength: settings.n_ctx,
      chatTemplateSha256: hash(props.chat_template ?? ''), samplingDefaults: settings.params ?? {},
      slots: slots.map(slot => ({ id: slot.id, n_ctx: slot.n_ctx, is_processing: slot.is_processing })),
      modalities: props.modalities };
  }
  const [version, tags, ps] = await Promise.all([get('/api/version'), get('/api/tags'), get('/api/ps')]);
  model ??= values.model;
  assert.ok(model, 'Explicit Ollama model name required');
  const stored = tags.models.find(item => item.name === model || item.model === model);
  const loaded = ps.models.find(item => item.name === model || item.model === model);
  assert.ok(stored && loaded, 'Ollama model must already be imported and preloaded');
  return { runtime: 'ollama', version: version.version, model, digest: stored.digest,
    details: stored.details, contextLength: loaded.context_length, sizeVram: loaded.size_vram,
    loaded: true };
}
const before = await snapshot();
const sourcePath = '.local/assistant-supabase-eval-20261023/live-01/provider-audit.json';
const sourceBytes = await readFile(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const originals = [], seen = new Set();
for (const event of source) {
  const question = JSON.parse(event.request.messages[1].content).question;
  if (seen.has(question)) continue;
  seen.add(question);
  originals.push({ id: `G0${originals.length + 1}`, question, original: event.request });
}
assert.equal(originals.length, 4);
const questions = [originals[1], originals[0], originals[3], originals[2]].map(item => ({
  id: item.id, question: item.question, request: { ...item.original, model },
  originalRequestSha256: hash(JSON.stringify(item.original)),
}));
const scenarios = [ { id: 'sequential', delayMs: 0, concurrency: 1 },
  { id: 'delay3s', delayMs: 3000, concurrency: 1 }, { id: 'parallel4', delayMs: 0, concurrency: 4 } ];
const plan = { startedAt: new Date().toISOString(), endpoint: endpoint.href, runtime: values.runtime, model,
  metadataBefore: before, sourcePath, sourceSha256: hash(sourceBytes), scenarios,
  requestsPlanned: 12, retries: 0, originalMessagesAndGenerationOptionsUnchanged: true,
  onlyPayloadChange: 'model routing identifier', appOrDatabaseMutated: false,
  gpuClockState: 'Not independently measured; no clock changes by agent',
  questions: questions.map(({ request, ...item }) => ({ ...item, requestSha256: hash(JSON.stringify(request)) })) };
await save('plan.json', plan);
const wire = [], wireIds = new WeakMap(), observerErrors = [];
let nextId = 0, scenarioId;
channel('undici:client:sendHeaders').subscribe(({ request, socket }) => {
  try {
    if (String(request.origin) !== endpoint.origin || request.path !== endpoint.pathname) return;
    const id = ++nextId; wireIds.set(request, id);
    wire.push({ type: 'sent', scenario: scenarioId, wireId: id, perfMs: performance.now(), at: new Date().toISOString(), localPort: socket.localPort });
  } catch (error) { observerErrors.push(error.name); }
});
channel('undici:request:headers').subscribe(({ request, response }) => {
  try {
    if (!wireIds.has(request)) return;
    wire.push({ type: 'responseHeaders', scenario: scenarioId, wireId: wireIds.get(request), perfMs: performance.now(), at: new Date().toISOString(), status: response.statusCode });
  } catch (error) { observerErrors.push(error.name); }
});
const batches = [];
for (const scenario of scenarios) {
  scenarioId = scenario.id;
  let active = 0, maxClientInFlight = 0;
  const completed = [];
  const batchStart = performance.now();
  async function call(item, position) {
    const start = performance.now();
    const result = { id: item.id, position, question: item.question, startedAt: new Date().toISOString(),
      startOffsetMs: start - batchStart, request: item.request, httpAttempts: 1 };
    active++; maxClientInFlight = Math.max(maxClientInFlight, active);
    try {
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.request), signal: AbortSignal.timeout(30_000) });
      result.status = response.status; result.rawResponse = await response.text();
      try {
        const payload = JSON.parse(result.rawResponse);
        if (payload.error) result.error = payload.error;
        const choice = payload.choices?.[0];
        if (choice) {
          result.finishReason = choice.finish_reason; result.modelContent = choice.message?.content;
          try {
            const answer = JSON.parse(result.modelContent);
            const allowed = new Set(JSON.parse(item.request.messages[1].content).knowledge.flatMap(entry => entry.citation_ids));
            result.answer = answer.answer; result.citationIds = answer.citation_ids;
            result.validAnswerEnvelope = typeof answer.answer === 'string' && !!answer.answer.trim()
              && Array.isArray(answer.citation_ids) && answer.citation_ids.length > 0
              && answer.citation_ids.every(id => allowed.has(id)) && choice.finish_reason !== 'length';
          } catch { result.validAnswerEnvelope = false; }
        }
      } catch { result.parseError = 'Non-JSON HTTP body'; }
    } catch (error) { result.transportError = { type: error.name, message: error.message, code: error.cause?.code }; }
    result.finishedAt = new Date().toISOString(); result.finishOffsetMs = performance.now() - batchStart;
    result.elapsedMs = Math.round(result.finishOffsetMs - result.startOffsetMs); active--;
    completed.push(result.id); result.completionPosition = completed.length;
    console.log(JSON.stringify({ scenario: scenario.id, position, id: item.id, status: result.status ?? null,
      elapsedMs: result.elapsedMs, validAnswerEnvelope: result.validAnswerEnvelope ?? null, error: result.error ?? result.transportError ?? null }));
    return result;
  }
  let results;
  if (scenario.concurrency === 4) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const pending = questions.map(async (item, index) => { await gate; return call(item, index + 1); });
    release();
    const settled = await Promise.allSettled(pending);
    results = settled.map((outcome, index) => outcome.status === 'fulfilled' ? outcome.value
      : { id: questions[index].id, position: index + 1, taskFailure: outcome.reason?.name });
  } else {
    results = [];
    for (const [index, item] of questions.entries()) {
      if (index && scenario.delayMs) await new Promise(resolve => setTimeout(resolve, scenario.delayMs));
      const gap = index ? Date.now() - Date.parse(results.at(-1).finishedAt) : null;
      const result = await call(item, index + 1); result.actualIdleGapBeforeMs = gap;
      results.push(result);
    }
  }
  await save(`${scenario.id}-requests.json`, results);
  const sent = wire.filter(event => event.scenario === scenario.id && event.type === 'sent');
  const headers = wire.filter(event => event.scenario === scenario.id && event.type === 'responseHeaders');
  const batch = { ...scenario, httpAttempts: results.length,
    successfulHttpResponses: results.filter(result => result.status === 200).length,
    validAnswerEnvelopes: results.filter(result => result.status === 200 && result.validAnswerEnvelope).length,
    engineErrors: results.filter(result => JSON.stringify(result.error ?? '').includes('Engine protocol predict request failed')).length,
    totalWallMs: Math.round(Math.max(...results.map(result => result.finishOffsetMs)) - Math.min(...results.map(result => result.startOffsetMs))),
    maxClientInFlight, allFourSentBeforeFirstResponse: sent.length === 4 && headers.length === 4
      && Math.max(...sent.map(event => event.perfMs)) < Math.min(...headers.map(event => event.perfMs)),
    results: results.map(({ request, rawResponse, modelContent, ...item }) => item) };
  batches.push(batch); await save('batches.json', batches);
  console.log('BATCH ' + JSON.stringify({ id: batch.id, successfulHttpResponses: batch.successfulHttpResponses,
    validAnswerEnvelopes: batch.validAnswerEnvelopes, engineErrors: batch.engineErrors, totalWallMs: batch.totalWallMs,
    maxClientInFlight, allFourSentBeforeFirstResponse: batch.allFourSentBeforeFirstResponse }));
}
const after = await snapshot();
const summary = { ...plan, finishedAt: new Date().toISOString(), metadataAfter: after,
  metadataUnchanged: JSON.stringify(before) === JSON.stringify(after), batches,
  httpAttempts: batches.reduce((count, batch) => count + batch.httpAttempts, 0), observerErrors,
  comparisonBoundary: 'Same public prompt/messages and generation fields except server model identifier; engine builds, prompt templates, slots and runtime defaults may differ. HTTP concurrency does not prove simultaneous token decoding.' };
await save('wire-audit.json', { wire, observerErrors }); await save('summary.json', summary);
console.log(JSON.stringify({ output, runtime: values.runtime, model, slots: before.totalSlots ?? null,
  httpAttempts: summary.httpAttempts, retries: 0, metadataUnchanged: summary.metadataUnchanged,
  successfulHttpResponses: batches.reduce((count, batch) => count + batch.successfulHttpResponses, 0),
  validAnswerEnvelopes: batches.reduce((count, batch) => count + batch.validAnswerEnvelopes, 0) }));
