import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { NewsFeed } from '../../src/lib/domain/news';

const licenseUrl = 'https://www.mohw.go.kr/menu.es?mid=a10103020100';
const newsError = '건강 소식을 새로 불러오지 못했어요. 잠시 후 다시 확인해 주세요.';
const titles = ['건강한 식사, 오늘부터 살펴볼 생활 습관', '숙면을 위한 생활 정보', '규칙적인 걷기와 건강', '의료 지원 제도 안내', '예방접종 일정 확인', '지역 건강 소식', '마음 건강 돌봄 안내', '건강검진 제도 안내'];

function sampleFeed(count = 8): NewsFeed {
  return {
    configured: true, provider: 'mohw',
    source_url: 'https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027&info',
    refresh: { status: 'fresh', last_success_at: '2026-10-23T06:00:00.000Z', error: null, automatic: true },
    articles: Array.from({ length: count }, (_, index) => ({
      id: `mohw-${1492314 - index}`, title: titles[index] ?? `건강 소식 ${index + 1}`,
      source: '보건복지부', author: index === 1 ? null : '자료 담당자',
      published_at: `2026-10-${String(23 - index).padStart(2, '0')}T05:05:00.000Z`,
      url: `https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&list_no=${1492314 - index}&act=view`,
      summary: index === 1 ? 'ABC 자료에서 확인할 수 있는 일반적인 건강 소식입니다.' : '보건복지부의 건강과 생활 소식을 안내합니다. 자세한 사항은 원문에서 확인할 수 있습니다.',
      license: 'KOGL-1', license_url: licenseUrl, fetched_at: '2026-10-23T06:00:00.000Z',
    })),
  };
}

async function login(page: Page, info: TestInfo) {
  const headers = { Origin: String(info.project.use.baseURL) };
  expect((await page.request.post('/api/login', { headers, data: { demoAccount: 'a' } })).ok()).toBeTruthy();
  const session = await (await page.request.get('/api/session')).json();
  if (session.consent !== 'current') expect((await page.request.post('/api/consent', { headers, data: { agreed: true } })).ok()).toBeTruthy();
}

test.beforeEach(async ({ page }, info) => { await login(page, info); });

test('건강 뉴스는 출처·날짜·원문·이용조건을 표시하고 여섯 개씩 더 보여준다', async ({ page }) => {
  const feed = sampleFeed();
  let requests = 0;
  await page.route('**/api/news', async route => { requests++; await route.fulfill({ json: feed }); });
  await page.goto('/news');
  await expect(page.getByRole('heading', { level: 1, name: '건강 뉴스', exact: true })).toBeVisible();
  await expect(page.getByText('보건복지부에서 전하는 건강과 생활 소식을 확인해요.', { exact: true })).toBeVisible();
  const list = page.getByRole('region', { name: '건강 뉴스 목록', exact: true });
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await expect(list.getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('status').filter({ hasText: '최근 소식 8개' })).toBeVisible();
  const first = list.getByRole('article').first();
  await expect(first.getByRole('heading', { level: 2 })).toHaveText(feed.articles[0].title);
  const original = first.getByRole('link', { name: `${feed.articles[0].title} 원문 보기 (새 탭)`, exact: true });
  await expect(original).toHaveAttribute('href', feed.articles[0].url);
  await expect(original).toHaveAttribute('target', '_blank');
  await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(first.getByText('보건복지부 · 자료 담당자', { exact: true })).toBeVisible();
  await expect(first.locator('time')).toHaveAttribute('datetime', '2026-10-23T05:05:00.000Z');
  await expect(first.locator('time')).toHaveText('2026년 10월 23일');
  await expect(first.getByRole('link', { name: '공공누리 제1유형 · 출처표시', exact: true })).toHaveAttribute('href', licenseUrl);
  await expect(list.locator('img, video, iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '소식 더 보기 (6/8)', exact: true }).click();
  await expect(list.getByRole('article')).toHaveCount(8);
  await expect(page.getByRole('button', { name: /소식 더 보기/ })).toHaveCount(0);
  await expect(page.getByText('보건복지부 소식의 일부를 발췌했어요. 자세한 내용과 변경 사항은 원문에서 확인해 주세요.', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('제목·본문 검색은 URL에 남고 즉시 지우기와 새로 열기에서 일관되게 적용된다', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/news', async route => { requests++; await route.fulfill({ json: sampleFeed() }); });
  await page.goto('/news?q=%EC%8B%9D%EC%82%AC');
  const input = page.getByRole('searchbox', { name: '소식 검색', exact: true });
  const articles = page.getByRole('region', { name: '건강 뉴스 목록', exact: true }).getByRole('article');
  await expect(input).toHaveValue('식사');
  await expect(articles).toHaveCount(1);
  await expect(articles.first()).toContainText(titles[0]);
  await input.fill('건강 한 식 사');
  await expect(articles).toHaveCount(1);
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('건강 한 식 사');
  await input.fill('ａｂｃ');
  await expect(articles).toHaveCount(1);
  await expect(articles.first()).toContainText(titles[1]);
  await input.fill('없는소식검색어');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요.', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '검색 결과 0개' })).toBeVisible();
  await expect(page.getByText('다른 단어로 검색해 보세요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '소식 검색어 지우기', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(articles).toHaveCount(6);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '소식 더 보기 (6/8)', exact: true }).click();
  await expect(articles).toHaveCount(8);
  await input.fill('식사');
  await page.reload();
  await expect(input).toHaveValue('식사');
  await expect(articles).toHaveCount(1);
  await page.getByRole('button', { name: '소식 검색어 지우기', exact: true }).click();
  await expect(articles).toHaveCount(6);
  expect(requests).toBe(2);
});

test('처음 불러오는 동안 상태를 알리고 중복 요청을 막는다', async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/news', async route => { requests++; await gate; await route.fulfill({ json: sampleFeed(1) }); });
  try {
    await page.goto('/news', { waitUntil: 'domcontentloaded' });
    const list = page.getByRole('region', { name: '건강 뉴스 목록', exact: true });
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(list.getByRole('status')).toHaveText('건강 소식을 불러오는 중이에요.');
    await expect(page.getByRole('button', { name: '불러오는 중', exact: true })).toBeDisabled();
    await expect(list.getByRole('article')).toHaveCount(0);
    expect(requests).toBe(1);
    release();
    await expect(list.getByRole('article')).toHaveCount(1);
    await expect(list).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: '새로 불러오기', exact: true })).toBeEnabled();
  } finally { release(); }
});

test('조회 실패는 빈 목록과 구분하고 다시 불러오면 성공한 소식을 표시한다', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/news', async route => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, json: { code: 'NEWS_UNAVAILABLE', error: newsError } });
    else await route.fulfill({ json: sampleFeed(1) });
  });
  await page.goto('/news');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(newsError);
  await expect(page.getByRole('heading', { name: '건강 소식을 불러오지 못했어요.', exact: true })).toBeVisible();
  await expect(page.getByText('아직 등록된 소식이 없어요.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '건강 소식을 불러오지 못했어요.', exact: true })).toHaveCount(0);
  expect(requests).toBe(2);
});

test('새 조회 중과 실패 후에도 기존 목록을 유지하고 오래된 자료 상태를 표시한다', async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const fresh = sampleFeed(2);
  const stale: NewsFeed = { ...fresh, refresh: { ...fresh.refresh, status: 'stale', error: newsError } };
  await page.route('**/api/news', async route => {
    requests++;
    if (requests === 2) { await gate; await route.fulfill({ status: 503, json: { code: 'NEWS_UNAVAILABLE', error: newsError } }); }
    else await route.fulfill({ json: requests === 3 ? stale : fresh });
  });
  try {
    await page.goto('/news');
    const list = page.getByRole('region', { name: '건강 뉴스 목록', exact: true });
    await expect(list.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(list.getByRole('article')).toHaveCount(2);
    await expect(list.getByRole('heading', { name: titles[0], exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '불러오는 중', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(`${newsError} 마지막으로 불러온 소식을 표시해요.`);
    await expect(list.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(`${newsError} 마지막으로 확인한 소식을 표시해요.`);
    await expect(list.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: '최근 소식 2개' })).toContainText('조회 10. 23. 오후 3:00');
    await page.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(list.getByRole('article')).toHaveCount(2);
    expect(requests).toBe(4);
  } finally { release(); }
});

test('정상 빈 목록은 조회 실패 없이 새 소식 대기 상태를 표시한다', async ({ page }) => {
  await page.route('**/api/news', route => route.fulfill({ json: sampleFeed(0) }));
  await page.goto('/news');
  await expect(page.getByRole('heading', { name: '아직 등록된 소식이 없어요.', exact: true })).toBeVisible();
  await expect(page.getByText('새로운 소식이 확인되면 이곳에 표시돼요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '최근 소식 0개' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
});

for (const width of [360, 768, 1280]) {
  test(`건강 뉴스 ${width}px 화면은 긴 한글에서도 가로 넘침과 접근성 오류가 없다`, async ({ page }, info) => {
    test.setTimeout(60_000);
    const feed = sampleFeed(2);
    feed.articles[0].title = '건강한생활습관을꾸준히실천하기위해알아두면좋은정보'.repeat(3);
    feed.articles[0].summary = '건강정보를확인할때는제공기관과자료가작성된시기를함께살펴보세요.'.repeat(5);
    await page.route('**/api/news', route => route.fulfill({ json: feed }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/news');
    const list = page.getByRole('region', { name: '건강 뉴스 목록', exact: true });
    await expect(list.getByRole('article')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    const input = page.getByRole('searchbox', { name: '소식 검색', exact: true });
    await input.focus();
    await expect(input).toBeFocused();
    await input.press('Tab');
    await expect(page.getByRole('button', { name: '새로 불러오기', exact: true })).toBeFocused();
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`news-${width}.png`), fullPage: true });
  });
}
