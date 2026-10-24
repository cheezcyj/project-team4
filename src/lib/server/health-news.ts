import type { NewsArticle, NewsFeed } from '../domain/news';
import { ApiError } from './errors';
import { fetchPublicText, parsePublicXml, plainText } from './public-content';

const FEED_URL = 'https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027&info';
const LICENSE_URL = 'https://www.mohw.go.kr/menu.es?mid=a10103020100';
const FRESH_MS = 15 * 60_000;
const STALE_MS = 6 * 60 * 60_000;
const RETRY_MS = 60_000;
const ERROR_MESSAGE = '건강 소식을 새로 불러오지 못했어요. 잠시 후 다시 확인해 주세요.';
const HEALTH_TITLE = /건강|의료|의약|치료|질환|질병|감염|예방|백신|검진|당뇨|비만|영양|운동|재활|돌봄|정신|마음|요양|간호|간병|환자|구급|바이오|헬스|보건기구|병원/;
type Options = { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal };
type State = { value?: NewsFeed; savedAt?: number; retryAt: number; inFlight?: Promise<NewsFeed> };
// Each transport has its own cache, so tests and alternate transports cannot share results.
const states = new WeakMap<typeof fetch, State>();

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  const node = object(value);
  return node && typeof node['#text'] === 'string' ? node['#text'] : '';
}

function articleUrl(value: string): { id: string; url: string } | null {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('list_no');
    if (url.protocol !== 'https:' || url.hostname !== 'www.mohw.go.kr' || url.username || url.password || url.port || url.pathname !== '/board.es' || url.searchParams.get('bid') !== '0027' || !id || !/^\d{1,12}$/.test(id) || url.searchParams.getAll('list_no').length !== 1) return null;
    // This is the canonical press-release path allowed by the provider's robots.txt.
    return { id: `mohw-${id}`, url: `https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&list_no=${id}&act=view` };
  } catch { return null; }
}

function publishedAt(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? new Date(parsed).toISOString() : null;
}

function excerpt(value: string, title: string): string {
  let result = plainText(value, 12_000);
  if (result.startsWith(title)) result = result.slice(title.length).replace(/^[\s:·\-–—]+/, '');
  const characters = [...result];
  if (characters.length <= 180) return result;
  const head = characters.slice(0, 179).join('');
  const boundary = head.lastIndexOf(' ');
  return `${(boundary > 140 ? head.slice(0, boundary) : head).trimEnd()}…`;
}

function permitsTextReuse(html: string): boolean {
  const blocks = [...html.matchAll(/<div\b[^>]*\bclass\s*=\s*["']([^"']*\bcodeView\d+\b[^"']*)["'][^>]*>([\s\S]*?)<\/div\s*>/gi)];
  if (blocks.length !== 1 || !blocks[0][1].split(/\s+/).includes('codeView01')) return false;
  const block = blocks[0][2];
  const licenseImage = [...block.matchAll(/<img\b[^>]*>/gi)].some(([image]) =>
    /\bsrc\s*=\s*["']\/kor\/img\/nuri\/codetype\/new_img_opentype01\.png["']/i.test(image) &&
    /\balt\s*=\s*["']공공누리\s*1유형["']/i.test(image));
  if (!licenseImage) return false;
  const licenseText = plainText(block);
  return licenseText.includes('출처표시') && !/(?:제\s*3\s*자|제삼자|third[\s-]*party|별도\s*(?:허락|허가|동의)|상업\s*(?:적\s*)?이용\s*금지|상업용\s*금지|변경\s*금지|이용\s*제한)/i.test(licenseText);
}

async function refresh(fetcher: typeof fetch, now: () => number): Promise<NewsFeed> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 28_000);
  try {
    const xml = await fetchPublicText(FEED_URL, { allowedHosts: ['www.mohw.go.kr'], fetch: fetcher, signal: controller.signal, maxBytes: 524_288 });
    const rss = object(object(parsePublicXml(xml))?.rss);
    const channel = object(rss?.channel);
    if (!channel) throw new Error('Invalid news feed.');
    const rawItems = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
    const fetchedAt = new Date(now()).toISOString();
    const seen = new Set<string>();
    const candidates: NewsArticle[] = [];
    for (const raw of rawItems.slice(0, 30)) {
      const entry = object(raw);
      if (!entry) continue;
      const link = articleUrl(text(entry.link));
      const title = plainText(text(entry.title), 250);
      if (!link || !title || !HEALTH_TITLE.test(title) || seen.has(link.id)) continue;
      seen.add(link.id);
      candidates.push({
        ...link, title, source: '보건복지부', author: plainText(text(entry.author), 100) || null,
        published_at: publishedAt(text(entry.pubDate)), summary: excerpt(text(entry.description), title),
        license: 'KOGL-1', license_url: LICENSE_URL, fetched_at: fetchedAt,
      });
    }
    candidates.sort((a, b) => (Date.parse(b.published_at ?? '') || 0) - (Date.parse(a.published_at ?? '') || 0));
    const selected = candidates.slice(0, 12);
    const verified = new Array<NewsArticle | null>(selected.length).fill(null);
    let cursor = 0, requestsCompleted = 0;
    const worker = async () => {
      while (!controller.signal.aborted && cursor < selected.length) {
        const index = cursor++;
        try {
          const html = await fetchPublicText(selected[index].url, { allowedHosts: ['www.mohw.go.kr'], fetch: fetcher, signal: controller.signal, maxBytes: 524_288, accept: 'text/html' });
          requestsCompleted++;
          if (permitsTextReuse(html)) verified[index] = selected[index];
        } catch { /* A failed or unverified item is never published. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
    if (selected.length && !requestsCompleted) throw new Error('News licenses could not be checked.');
    return {
      articles: verified.filter((article): article is NewsArticle => article !== null), configured: true, provider: 'mohw',
      refresh: { status: 'fresh', last_success_at: fetchedAt, error: null, automatic: true }, source_url: FEED_URL,
    };
  } finally { clearTimeout(deadline); }
}

function unavailable(): ApiError { return new ApiError(503, 'NEWS_UNAVAILABLE', ERROR_MESSAGE); }

function staleOrThrow(state: State, time: number): NewsFeed {
  if (!state.value || state.savedAt === undefined || time - state.savedAt > STALE_MS) throw unavailable();
  return { ...state.value, refresh: { ...state.value.refresh, status: 'stale', error: ERROR_MESSAGE } };
}

async function forCaller(promise: Promise<NewsFeed>, signal?: AbortSignal): Promise<NewsFeed> {
  if (!signal) return structuredClone(await promise);
  if (signal.aborted) throw unavailable();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(unavailable());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => resolve(structuredClone(value)), reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function listHealthNews(options: Options = {}): Promise<NewsFeed> {
  if (options.signal?.aborted) throw unavailable();
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const time = now();
  let state = states.get(fetcher);
  if (!state) { state = { retryAt: 0 }; states.set(fetcher, state); }
  if (state.value && state.savedAt !== undefined && time - state.savedAt < FRESH_MS) return structuredClone(state.value);
  if (state.inFlight) return forCaller(state.inFlight, options.signal);
  if (time < state.retryAt) return structuredClone(staleOrThrow(state, time));
  const current = state;
  // One caller cancelling must not cancel a refresh used by other callers.
  current.inFlight = refresh(fetcher, now).then((value) => {
    current.value = value; current.savedAt = now(); current.retryAt = 0;
    return value;
  }).catch(() => {
    current.retryAt = now() + RETRY_MS;
    return staleOrThrow(current, now());
  }).finally(() => { current.inFlight = undefined; });
  return forCaller(current.inFlight, options.signal);
}
