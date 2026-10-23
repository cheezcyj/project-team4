import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';

const root = process.cwd();
const folder = path.resolve('.local/assistant-ollama-runtime-20261023-02');
await mkdir(folder);
const ollama = path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe');
await stat(ollama);
const base = 'http://127.0.0.1:11435';
try { await fetch(base + '/api/version', { signal: AbortSignal.timeout(1000) }); throw new Error('Test port already occupied'); }
catch (error) { assert.equal(error.name, 'TypeError', 'Test port must be unused'); }
const props = await (await fetch('http://127.0.0.1:11480/props')).json();
const gguf = props.model_alias;
assert.ok(gguf && path.isAbsolute(gguf));
const sourceSize = (await stat(gguf)).size;
console.log('Hashing the existing GGUF; no model download');
const sourceHash = createHash('sha256');
for await (const chunk of createReadStream(gguf)) sourceHash.update(chunk);
const sourceSha256 = sourceHash.digest('hex');
const model = 'team4-gemma4-e4b-qat:comparison';
const modelStore = path.join(folder, 'models');
const modelfile = path.join(folder, 'Modelfile');
await writeFile(modelfile, `FROM ${JSON.stringify(gguf.replaceAll('\\', '/'))}\nPARAMETER num_ctx 131072\nPARAMETER temperature 0.1\nPARAMETER num_predict 512\n`);
const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_MODELS: modelStore,
  OLLAMA_NUM_PARALLEL: '4', OLLAMA_CONTEXT_LENGTH: '131072', OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'f16', OLLAMA_NO_CLOUD: '1' };
const setup = { startedAt: new Date().toISOString(), base, model, gguf, sourceSize, sourceSha256,
  modelStore, parameters: { num_ctx: 131072, temperature: 0.1, num_predict: 512 },
  serverSettings: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('OLLAMA_'))),
  existingServersPreserved: [11480, 11434, 1234], existingAppConfigurationChanged: false,
  inferenceQuestionsPlanned: 12, emptyPromptPreloadsPlanned: 1, modelDownloaded: false, success: false };
// Store only the explicit controlled environment, never inherited credentials.
setup.serverSettings = Object.fromEntries(['OLLAMA_HOST','OLLAMA_MODELS','OLLAMA_NUM_PARALLEL','OLLAMA_CONTEXT_LENGTH',
  'OLLAMA_MAX_LOADED_MODELS','OLLAMA_FLASH_ATTENTION','OLLAMA_KV_CACHE_TYPE','OLLAMA_NO_CLOUD'].map(key => [key, env[key]]));
const save = async (name, value) => writeFile(path.join(folder, name), JSON.stringify(value, null, 2) + '\n');
await save('setup.json', setup);
const serverLog = createWriteStream(path.join(folder, 'server.log'));
await once(serverLog, 'open');
let server;
async function child(executable, args, logName, timeout = 180_000) {
  const log = createWriteStream(path.join(folder, logName));
  await once(log, 'open');
  const processChild = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
  const timer = setTimeout(() => { try { execFileSync('taskkill', ['/pid', String(processChild.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already exited. */ } }, timeout);
  try {
    const code = await new Promise((resolve, reject) => { processChild.once('error', reject); processChild.once('exit', resolve); });
    assert.equal(code, 0, `${logName} child must finish successfully`);
  } finally { clearTimeout(timer); log.end(); }
}
try {
  console.log('Starting isolated Ollama on 11435 with parallel=4; existing servers unchanged');
  server = spawn(ollama, ['serve'], { cwd: root, env, windowsHide: true, stdio: ['ignore', serverLog, serverLog] });
  let ready = false;
  for (let index = 0; index < 100; index++) {
    assert.equal(server.exitCode, null, 'Ollama server exited during startup');
    try {
      const response = await fetch(base + '/api/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { setup.version = (await response.json()).version; ready = true; break; }
    } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ready, 'Ollama must become ready');
  console.log('Importing existing GGUF into the isolated model store');
  await child(ollama, ['create', model, '-f', modelfile], 'import.log');
  const importedBlob = path.join(modelStore, 'blobs', `sha256-${sourceSha256}`);
  assert.equal((await stat(importedBlob)).size, sourceSize, 'Imported GGUF blob must match original hash and size');
  setup.importedBlobMatchesSourceHash = true;
  const showResponse = await fetch(base + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
  assert.equal(showResponse.status, 200);
  const show = await showResponse.json(); await save('model-show.json', show);
  console.log('Preloading model with an empty prompt, then running 12 question requests');
  const response = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '10m', options: { num_ctx: 131072 } }), signal: AbortSignal.timeout(180_000) });
  const preload = await response.json(); await save('preload.json', { status: response.status, ...preload });
  assert.equal(response.status, 200, 'Model preload must succeed');
  assert.ok(!preload.response && !preload.eval_count, 'Preload must not generate an answer');
  const loaded = await (await fetch(base + '/api/ps')).json(); await save('loaded-models.json', loaded);
  setup.loaded = loaded.models.find(item => item.name === model || item.model === model);
  assert.ok(setup.loaded);
  assert.equal(setup.loaded.context_length, 131072, 'Loaded context must match intended setting');
  await save('setup.json', setup);
  await child(process.execPath, ['.local/probe-model-runtime-20261023.mjs', '--run', '--runtime', 'ollama', '--base-url', base,
    '--model', model, '--output', '.local/assistant-runtime-ollama11435-20261023-01'], 'probe.log');
  const result = JSON.parse(await readFile('.local/assistant-runtime-ollama11435-20261023-01/summary.json', 'utf8'));
  setup.result = { attempts: result.httpAttempts, successfulHttpResponses: result.batches.reduce((count, batch) => count + batch.successfulHttpResponses, 0),
    validAnswerEnvelopes: result.batches.reduce((count, batch) => count + batch.validAnswerEnvelopes, 0), metadataUnchanged: result.metadataUnchanged };
  setup.success = true;
} catch (error) {
  setup.failure = { type: error.name, message: error.message };
  console.error('FAIL ' + JSON.stringify(setup.failure));
} finally {
  if (server && server.exitCode === null) {
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); }
    catch { /* It may already have exited. */ }
  }
  serverLog.end(); setup.finishedAt = new Date().toISOString(); setup.temporaryServerStopped = true;
  await save('setup.json', setup);
  console.log(JSON.stringify({ folder, success: setup.success, version: setup.version,
    sameGguf: setup.importedBlobMatchesSourceHash ?? false, result: setup.result ?? null, temporaryServerStopped: true }));
}
process.exitCode = setup.success ? 0 : 1;
