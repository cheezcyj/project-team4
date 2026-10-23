import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from '@playwright/test';

const folder = '.local/assistant-supabase-eval-20261023';
const account = JSON.parse((await readFile('.local/supabase-setup-20261023/test-accounts.json', 'utf8')).replace(/^\uFEFF/, ''))[0];
const base = 'http://127.0.0.1:3006';
const control = await request.newContext({ baseURL: 'http://127.0.0.1:3005' });
let client, app, calls = 0;
const log = createWriteStream(`${folder}/production-server.log`);
const result = { mode: 'production Supabase, evaluation flags deliberately enabled', modelRequests: 0, hostedDbMutated: false, success: false };
const proxy = createServer((_req, res) => { calls++; res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"Unexpected model call"}'); });
try {
  const response = await control.post('/api/login', { headers: { Origin: 'http://127.0.0.1:3005' }, data: { email: account.email, password: account.password } });
  assert.equal(response.status(), 200);
  const session = await response.json();
  assert.equal(session.mode, 'supabase'); assert.equal(session.consent, 'current');
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(11481, '127.0.0.1', resolve); });
  app = spawn(process.execPath, ['scripts/start-production.mjs'], {
    windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env,
      PORT: '3006', NEXT_DIST_DIR: '.local/assistant-supabase-eval-build', NODE_ENV: 'production', APP_MODE: 'supabase',
      ASSISTANT_ENABLED: '1', ASSISTANT_ALLOW_DRAFT_PREVIEW: '1', ASSISTANT_SUPABASE_EVAL_USER_IDS: session.user.id,
      ASSISTANT_MODEL_BASE_URL: 'http://127.0.0.1:11481/v1',
    },
  });
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(ready, true);
  client = await request.newContext({ baseURL: base, storageState: await control.storageState() });
  const auth = await (await client.get('/api/session')).json();
  assert.equal(auth.user.id, session.user.id); assert.equal(auth.mode, 'supabase');
  const status = await (await client.get('/api/assistant')).json();
  assert.equal(status.available, false); assert.equal(status.draftPreview, false); assert.equal(status.recordSummaryAvailable, true);
  const denied = await client.post('/api/assistant', { headers: { Origin: base }, data: { question: '당화혈색소가 무엇인가요?', allow_model_processing: true } });
  assert.equal(denied.status(), 503); assert.equal((await denied.json()).code, 'ASSISTANT_UNAVAILABLE');
  const summary = await client.post('/api/assistant/records-summary', { headers: { Origin: base }, data: { allow_record_access: true } });
  assert.equal(summary.status(), 200); assert.equal((await summary.json()).recordSummary.count, 0);
  assert.equal(calls, 0);
  result.success = true; result.status = status; result.questionStatus = denied.status(); result.recordSummaryCount = 0;
} catch (error) {
  result.failure = { type: error.name, message: String(error.message).slice(0, 200) }; console.error(result.failure);
} finally {
  result.modelRequests = calls;
  await client?.dispose(); await control.dispose();
  if (app && app.exitCode === null) { try { execFileSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already stopped. */ } }
  if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
  log.end();
  await writeFile(`${folder}/production-gate.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  process.exitCode = result.success ? 0 : 1;
}
