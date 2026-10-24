import assert from 'node:assert/strict';
import test from 'node:test';
import { listHealthNews } from '../../src/lib/server/health-news';
import { fetchPublicText, parsePublicXml, plainText } from '../../src/lib/server/public-content';
import { ApiError } from '../../src/lib/server/errors';

const now = Date.parse('2026-10-23T07:00:00.000Z');
const license = '<div class="codeView01"><img src="/kor/img/nuri/codetype/new_img_opentype01.png" alt="공공누리 1유형"/> 본 공공저작물은 공공누리 <a href="/menu.es?mid=a10103020100">"출처표시"</a> 조건에 따라 이용할 수 있습니다.</div>';
const item = (id: number, options: { title?: string; date?: string; url?: string; description?: string } = {}) => `<item><title><![CDATA[${options.title ?? `건강 소식 ${id}`}]]></title><link>${(options.url ?? `https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=${id}&act=view`).replaceAll('&', '&amp;')}</link><description><![CDATA[${options.description ?? '국민 건강을 위한 소식입니다.'}]]></description><pubDate>${options.date ?? 'Fri, 23 Oct 2026 05:05:00 GMT'}</pubDate><author>자료 담당자</author></item>`;
const feed = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>보건복지부</title>${items}</channel></rss>`;
const response = (body: string, status = 200) => new Response(body, { status });
const mockFetch = (handler: (url: string, options?: RequestInit) => Promise<Response> | Response): typeof fetch => (async (input, options) => handler(String(input), options)) as typeof fetch;

test('known MOHW RSS structure produces attributed KOGL1 text with normalized original links', async () => {
  const urls: string[] = [];
  const fetch = mockFetch((url) => { urls.push(url); return response(url.includes('/rss/') ? feed(item(1492314)) : license); });
  const result = await listHealthNews({ fetch, now: () => now });
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0], {
    id: 'mohw-1492314', title: '건강 소식 1492314', source: '보건복지부', author: '자료 담당자',
    published_at: '2026-10-23T05:05:00.000Z',
    url: 'https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&list_no=1492314&act=view',
    summary: '국민 건강을 위한 소식입니다.', license: 'KOGL-1',
    license_url: 'https://www.mohw.go.kr/menu.es?mid=a10103020100', fetched_at: new Date(now).toISOString(),
  });
  assert.equal(result.refresh.status, 'fresh');
  assert.equal(urls.length, 2);
  assert.equal(urls[1], result.articles[0].url);
});

test('news excludes absent, contradictory and third-party-restricted licenses', async () => {
  const html = [license, '<nav>공공누리 1유형 출처표시 new_img_opentype01.png</nav>', license.replace('출처표시', '출처표시 + 상업적 이용금지'), license.replace('조건에', '제3자의 저작권 자료는 별도 허락이 필요합니다. 조건에'), license.replace('codeView01', 'codeView010')];
  const fetch = mockFetch((url) => response(url.includes('/rss/') ? feed(html.map((_, i) => item(i + 1)).join('')) : html[Number(new URL(url).searchParams.get('list_no')) - 1]));
  const result = await listHealthNews({ fetch, now: () => now });
  assert.deepEqual(result.articles.map((article) => article.id), ['mohw-1']);
});

test('the health feed omits unrelated ministry announcements and does not repeat or silently cut a title', async () => {
  const urls: string[] = [];
  const title = '건강한 생활 소식';
  const fetch = mockFetch(url => {
    urls.push(url);
    return response(url.includes('/rss/') ? feed(item(1, { title: '국민연금기금운용위원회 개최' }) + item(2, { title, description: `${title} - ${'생활 습관에 관한 공개 소식입니다. '.repeat(30)}` })) : license);
  });
  const result = await listHealthNews({ fetch, now: () => now });
  assert.deepEqual(result.articles.map(article => article.id), ['mohw-2']);
  assert.equal(urls.length, 2);
  assert.equal(result.articles[0].summary.startsWith(title), false);
  assert.ok([...result.articles[0].summary].length <= 180);
  assert.ok(result.articles[0].summary.endsWith('…'));
});

test('untrusted URLs are not fetched; duplicate articles are suppressed and invalid dates stay unknown', async () => {
  const links = ['https://evil.example/board.es?list_no=8', 'http://www.mohw.go.kr/board.es?list_no=9', 'https://name:pass@www.mohw.go.kr/board.es?list_no=10', 'https://www.mohw.go.kr/download.es?list_no=11', 'https://www.mohw.go.kr/board.es?bid=0027&list_no=bad', 'https://www.mohw.go.kr/board.es?bid=0025&list_no=12'];
  const visited: string[] = [];
  const fetch = mockFetch((url) => { visited.push(url); return response(url.includes('/rss/') ? feed(links.map((url, i) => item(i, { url })).join('') + item(20, { date: 'not-a-date' }) + item(20)) : license); });
  const result = await listHealthNews({ fetch, now: () => now });
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].published_at, null);
  assert.equal(visited.length, 2);
});

test('news returns up to twelve latest articles and bounds concurrent original-page checks', async () => {
  let active = 0, maximum = 0, originals = 0;
  const fetch = mockFetch(async (url) => {
    if (url.includes('/rss/')) return response(feed(Array.from({ length: 30 }, (_, i) => item(i + 1, { date: `Thu, 22 Oct 2026 ${String(i % 24).padStart(2, '0')}:00:00 GMT` })).join('')));
    originals++; active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2)); active--;
    return response(license);
  });
  const result = await listHealthNews({ fetch, now: () => now });
  assert.equal(result.articles.length, 12);
  assert.equal(originals, 12);
  assert.ok(maximum <= 3);
  assert.equal(result.articles[0].id, 'mohw-24');
});

test('fresh requests share one in-flight refresh and cached values cannot be mutated by a caller', async () => {
  let count = 0;
  const fetch = mockFetch(async (url) => { count++; await new Promise((resolve) => setTimeout(resolve, 2)); return response(url.includes('/rss/') ? feed(item(1)) : license); });
  const [a, b] = await Promise.all([listHealthNews({ fetch, now: () => now }), listHealthNews({ fetch, now: () => now })]);
  a.articles[0].title = 'changed';
  const c = await listHealthNews({ fetch, now: () => now + 14 * 60_000 });
  assert.equal(count, 2);
  assert.equal(b.articles[0].title, '건강 소식 1');
  assert.equal(c.articles[0].title, '건강 소식 1');
});

test('temporary feed errors preserve recent verified data, back off and expire stale content after six hours', async () => {
  let calls = 0, fail = false, time = now;
  const fetch = mockFetch((url) => { calls++; return response(fail ? 'private upstream error details' : url.includes('/rss/') ? feed(item(1)) : license, fail ? 503 : 200); });
  await listHealthNews({ fetch, now: () => time });
  fail = true; time += 16 * 60_000;
  const stale = await listHealthNews({ fetch, now: () => time });
  assert.equal(stale.refresh.status, 'stale');
  assert.equal(stale.articles[0].id, 'mohw-1');
  assert.ok(stale.refresh.error && !stale.refresh.error.includes('private'));
  await listHealthNews({ fetch, now: () => time + 1_000 });
  assert.equal(calls, 3);
  time = now + 6 * 60 * 60_000 + 1;
  await assert.rejects(listHealthNews({ fetch, now: () => time }), (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === 'NEWS_UNAVAILABLE');
});

test('partial original-page failure keeps verified successes and cold failures are throttled', async () => {
  const partial = mockFetch((url) => response(url.includes('/rss/') ? feed(item(1) + item(2)) : url.includes('list_no=1&') ? license : 'failure', url.includes('list_no=2&') ? 503 : 200));
  const result = await listHealthNews({ fetch: partial, now: () => now });
  assert.deepEqual(result.articles.map((article) => article.id), ['mohw-1']);
  let calls = 0;
  const failed = mockFetch(() => { calls++; return response('upstream detail', 500); });
  for (let i = 0; i < 2; i++) await assert.rejects(listHealthNews({ fetch: failed, now: () => now }), (error: unknown) => error instanceof ApiError && error.code === 'NEWS_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('confirmed disallowed articles yield a fresh empty list, while all original-page failures retain stale data', async () => {
  const unlicensed = mockFetch((url) => response(url.includes('/rss/') ? feed(item(1)) : '<div>이용허락 표시 없음</div>'));
  const empty = await listHealthNews({ fetch: unlicensed, now: () => now });
  assert.equal(empty.refresh.status, 'fresh');
  assert.deepEqual(empty.articles, []);
  let fail = false, time = now;
  const fetch = mockFetch((url) => url.includes('/rss/') ? response(feed(item(1))) : response(fail ? 'unavailable' : license, fail ? 503 : 200));
  await listHealthNews({ fetch, now: () => time });
  time += 16 * 60_000; fail = true;
  const stale = await listHealthNews({ fetch, now: () => time });
  assert.equal(stale.refresh.status, 'stale');
  assert.equal(stale.articles[0].id, 'mohw-1');
});

test('cancelling one caller does not cancel a refresh shared by another caller', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const fetch = mockFetch(async (url) => { calls++; await gate; return response(url.includes('/rss/') ? feed(item(1)) : license); });
  const controller = new AbortController();
  const cancelled = listHealthNews({ fetch, now: () => now, signal: controller.signal });
  const waiting = listHealthNews({ fetch, now: () => now });
  controller.abort();
  await assert.rejects(cancelled, (error: unknown) => error instanceof ApiError && error.code === 'NEWS_UNAVAILABLE');
  release?.();
  assert.equal((await waiting).articles.length, 1);
  assert.equal(calls, 2);
});

test('public text strips executable HTML and decodes named/numeric entities before Unicode truncation', () => {
  assert.equal(plainText('<script>secret()</script><style>x{}</style><p>A &amp; B&nbsp; &#x1F34E; &ldquo;인용&rdquo;</p>'), 'A & B 🍎 “인용”');
  assert.equal(plainText('&lt;img src=x onerror=secret()&gt;본문'), '본문');
  assert.equal(plainText('🍎🍏🍐', 2), '🍎🍏');
  assert.equal(plainText('a&#0;b&#xD800;c'), 'a�b�c');
  assert.ok(plainText('문'.repeat(300), 250).length <= 250);
});

test('XML parser rejects entity declarations and malformed data without expanding them', () => {
  assert.throws(() => parsePublicXml('<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>'));
  assert.throws(() => parsePublicXml('<rss><channel></rss>'));
  assert.ok(parsePublicXml(feed(item(1))));
});

test('public fetch rejects unsafe URLs, redirect responses and oversized streamed bodies', async () => {
  let calls = 0;
  const fetch = mockFetch(() => { calls++; return response('safe'); });
  for (const url of ['http://www.mohw.go.kr/', 'https://bad.example/', 'https://x:y@www.mohw.go.kr/', 'https://www.mohw.go.kr:8443/']) await assert.rejects(fetchPublicText(url, { allowedHosts: ['www.mohw.go.kr'], fetch }));
  assert.equal(calls, 0);
  await assert.rejects(fetchPublicText('https://www.mohw.go.kr/', { allowedHosts: ['www.mohw.go.kr'], fetch: mockFetch(() => Response.redirect('https://bad.example/')) }));
  await assert.rejects(fetchPublicText('https://www.mohw.go.kr/', { allowedHosts: ['www.mohw.go.kr'], maxBytes: 4, fetch: mockFetch(() => response('12345')) }));
});

test('public fetch enforces abort timeout and uses anonymous non-redirecting bounded requests', async () => {
  const hanging = mockFetch((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }));
  await assert.rejects(fetchPublicText('https://www.mohw.go.kr/', { allowedHosts: ['www.mohw.go.kr'], fetch: hanging, timeoutMs: 10 }));
  const fetch = mockFetch((_url, options) => { assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit'); assert.equal(options?.cache, 'no-store'); return response('text'); });
  assert.equal(await fetchPublicText('https://www.mohw.go.kr/', { allowedHosts: ['www.mohw.go.kr'], fetch }), 'text');
});

test('body reads also time out and do not trust an understated content-length', async () => {
  let cancelled = false;
  const hangingBody = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(fetchPublicText('https://www.mohw.go.kr/', {
    allowedHosts: ['www.mohw.go.kr'], timeoutMs: 10,
    fetch: mockFetch(() => new Response(hangingBody)),
  }));
  assert.equal(cancelled, true);
  await assert.rejects(fetchPublicText('https://www.mohw.go.kr/', {
    allowedHosts: ['www.mohw.go.kr'], maxBytes: 4,
    fetch: mockFetch(() => new Response('123456789', { headers: { 'content-length': '1' } })),
  }));
});
