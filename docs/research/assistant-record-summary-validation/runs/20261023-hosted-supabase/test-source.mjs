import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const baseURL = 'http://127.0.0.1:3005';
const headers = { Origin: baseURL };
const accounts = JSON.parse((await readFile(new URL('./test-accounts.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
assert.ok(accounts.every(a => a.email.endsWith('@team4-test.invalid')));
const initialRun = JSON.parse(await readFile(new URL('./hosted-validation-initial.json', import.meta.url), 'utf8'));
const results = [];
const summaries = [];
const created = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const a = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 } });
const b = await browser.newContext({ baseURL });
const anon = await browser.newContext({ baseURL });
const endpoint = '/api/assistant/records-summary';
let success = false;
let phase = 'API and RLS';

async function api(context, method, path, data, status = 200) {
  const response = await context.request.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });
  const body = await response.json();
  assert.equal(response.status(), status, `${method} ${path}: ${body.code || response.status()}`);
  return body;
}
function pass(name) { results.push({ name, result: 'pass' }); console.log(`PASS ${name}`); }
async function add(context, value) {
  const id = randomUUID();
  const body = await api(context, 'POST', '/api/records', {
    id, glucose_mg_dl: value, measured_at: new Date(Date.now() - 60_000).toISOString(),
    measurement_context: 'fasting', meal_memo: 'PRIVATE_SYNTHETIC_HOSTED_MEMO',
  }, 201);
  created.push({ context, id });
  return body.record;
}

try {
  assert.equal((await api(anon, 'GET', '/api/session')).mode, 'supabase');
  await api(anon, 'POST', endpoint, { allow_record_access: true }, 401);
  pass('Supabase mode and anonymous summary rejection');
  for (const [context, account] of [[a, accounts[0]], [b, accounts[1]]]) {
    const session = await api(context, 'POST', '/api/login', { email: account.email, password: account.password });
    assert.equal(session.mode, 'supabase');
    if (session.consent === 'missing') {
      assert.equal((await api(context, 'POST', endpoint, { allow_record_access: true }, 403)).code, 'RECORD_CONSENT_REQUIRED');
    } else {
      assert.equal(session.consent, 'current');
      assert.ok(initialRun.results.some(r => r.name === 'Two hosted Auth logins, SSR cookies and service consent' && r.result === 'pass'));
    }
    await api(context, 'POST', '/api/consent', { agreed: true });
  }
  pass('Two hosted Auth logins and SSR cookies; initial service-consent negative checks retained');
  assert.equal((await api(a, 'POST', endpoint, {}, 403)).code, 'RECORD_ACCESS_CONSENT_REQUIRED');
  assert.equal((await api(a, 'POST', endpoint, { allow_record_access: true, user_id: randomUUID() }, 422)).code, 'INVALID_INPUT');
  const wrongOrigin = await a.request.post(endpoint, { headers: { Origin: 'https://unrelated.example' }, data: { allow_record_access: true } });
  assert.equal(wrongOrigin.status(), 403);
  pass('Request permission, injected owner and foreign Origin rejection');

  const first = await add(a, 110);
  const second = await add(a, 130);
  const otherUserRecord = await add(b, 250);
  assert.equal((await api(a, 'GET', '/api/records')).records.length, 2);
  await api(a, 'GET', `/api/records/${otherUserRecord.id}`, undefined, 404);
  pass('Hosted record creation and app-level account separation');

  const directA = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: directLoginError } = await directA.auth.signInWithPassword({ email: accounts[0].email, password: accounts[0].password });
  assert.equal(directLoginError, null);
  const foreignRead = await directA.from('glucose_records').select('id').eq('id', otherUserRecord.id);
  assert.equal(foreignRead.error, null); assert.deepEqual(foreignRead.data, []);
  const foreignUpdate = await directA.from('glucose_records').update({ glucose_mg_dl: 999 }).eq('id', otherUserRecord.id).select('id');
  assert.equal(foreignUpdate.error, null); assert.deepEqual(foreignUpdate.data, []);
  const foreignDelete = await directA.from('glucose_records').delete().eq('id', otherUserRecord.id).select('id');
  assert.equal(foreignDelete.error, null); assert.deepEqual(foreignDelete.data, []);
  const foreignInsert = await directA.from('glucose_records').insert({
    id: randomUUID(), user_id: otherUserRecord.user_id, glucose_mg_dl: 999,
    measured_at: new Date().toISOString(), measurement_context: 'fasting',
  });
  assert.equal(foreignInsert.error?.code, '42501');
  assert.equal((await api(b, 'GET', `/api/records/${otherUserRecord.id}`)).record.glucose_mg_dl, 250);
  await directA.auth.signOut({ scope: 'local' });
  pass('Direct PostgREST RLS blocks cross-account read, update, delete and insert');

  const page = await a.newPage();
  const editor = await a.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible({ timeout: 20000 });
  const answer = page.getByRole('region', { name: '도우미 답변' });
  const panel = page.getByRole('dialog', { name: '이어드림 도우미', exact: true });
  const dashboardRows = page.getByRole('table', { name: /그래프와 같은 최근 7일 기록/ }).locator('tbody tr');
  async function summary(step, expected) {
    phase = step;
    await page.getByRole('button', { name: '도우미 열기', exact: true }).click();
    const permission = page.getByRole('checkbox', { name: '이번 요약을 위해 본인의 최근 7일 공복 기록 조회에 동의합니다.', exact: true });
    await expect(permission).not.toBeChecked();
    await permission.check();
    const pending = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
    await page.getByRole('button', { name: '공복 기록 요약', exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200);
    const result = await response.json();
    for (const [key, value] of Object.entries(expected)) assert.equal(result.recordSummary[key], value, `${step}: ${key}`);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SYNTHETIC_HOSTED_MEMO'));
    await expect(answer).toContainText(expected.average === null ? '계산하지 않았어요' : `평균 ${expected.average}`);
    await expect(answer).toContainText('기록은 AI에 전송하지 않았어요');
    summaries.push({ step, ...expected });
  }
  await summary('initial', { count: 2, average: 120, min: 110, max: 130 });
  await editor.goto(`/records/${second.id}/edit`);
  await editor.getByLabel('혈당값', { exact: false }).fill('140');
  await editor.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(editor).toHaveURL(/\/records\?date=/);
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('table', { name: /그래프와 같은 최근 7일 기록/ }).locator('tbody tr').filter({ hasText: /140\s*mg\/dL/ })).toHaveCount(1);
  await summary('value edited', { count: 2, average: 125, min: 110, max: 140 });
  await page.screenshot({ path: new URL('./hosted-summary-after-edit-360.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await editor.goto(`/records/${second.id}/edit`);
  await editor.getByRole('radio', { name: '식전', exact: true }).check();
  await editor.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(editor).toHaveURL(/\/records\?date=/);
  await expect(panel).not.toBeVisible();
  await expect(dashboardRows.filter({ hasText: /140\s*mg\/dL/ })).toContainText('식전');
  await summary('reclassified', { count: 1, average: 110, min: 110, max: 110 });
  for (const [record, step, expected] of [
    [second, 'non-fasting deleted', { count: 1, average: 110, min: 110, max: 110 }],
    [first, 'last fasting deleted', { count: 0, average: null, min: null, max: null }],
  ]) {
    await editor.goto(`/records/${record.id}/edit`);
    await editor.getByRole('button', { name: '기록 삭제', exact: true }).click();
    await editor.getByRole('dialog', { name: '이 기록을 삭제할까요?', exact: true }).getByRole('button', { name: '기록 삭제', exact: true }).click();
    await expect(editor).toHaveURL(/\/records\?date=/);
    created.find(item => item.id === record.id).deleted = true;
    await expect(panel).not.toBeVisible();
    await expect(dashboardRows.filter({ hasText: new RegExp(`${record.id === second.id ? 140 : 110}\\s*mg\\/dL`) })).toHaveCount(0);
    await summary(step, expected);
  }
  await expect(page.getByRole('heading', { name: '최근 7일에 남긴 기록이 없어요.', exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: new URL('./hosted-summary-empty-360.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  pass('Five hosted summary transitions, cross-tab invalidation and dashboard updates at 360px');
  await editor.goto('/dashboard');
  await editor.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  pass('Cross-tab logout clears authenticated screen');
  success = true;
} catch (error) {
  results.push({ name: 'validation stopped', result: 'fail', phase, message: error.message });
  await a.pages()[0]?.screenshot({ path: new URL('./hosted-failure.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const cleanup = [];
  for (const item of created) {
    if (item.deleted) { cleanup.push('already deleted by UI'); continue; }
    const response = await item.context.request.delete(`/api/records/${item.id}`, { headers }).catch(() => null);
    cleanup.push(response?.status() ?? 'network error');
  }
  const report = { date: '2026-10-23', scope: 'real hosted Supabase Auth/JWT/PostgREST and local Next dev app',
    runtime: 'Next.js 16.4.2 development, Webpack',
    serviceConsentChecksFrom: 'hosted-validation-initial.json',
    success, modelInferenceRun: false, appSourceModified: false, results, summaries, cleanupStatuses: cleanup };
  await writeFile(new URL('./hosted-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
