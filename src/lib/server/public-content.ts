import { decodeHTML } from 'entities';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

type PublicTextOptions = {
  allowedHosts: readonly string[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
};

function publicUrl(value: string, allowedHosts: readonly string[]): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('Public source URL is not allowed.');
  }
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Public source request was cancelled.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Public source request was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Public content requests never forward account headers, cookies, or upstream error bodies. */
export async function fetchPublicText(url: string, options: PublicTextOptions): Promise<string> {
  const address = publicUrl(url, options.allowedHosts);
  const maxBytes = options.maxBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_097_152) throw new Error('Invalid public source size limit.');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1, options.timeoutMs ?? 5_000)));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) throw new Error('Cancelled.');
    const result = await abortable((options.fetch ?? globalThis.fetch)(address.href, {
      headers: { Accept: options.accept ?? 'application/xml,text/xml,text/html;q=0.9' },
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    }), signal);
    if (!result.ok || result.redirected || (result.url && publicUrl(result.url, options.allowedHosts).href !== address.href)) throw new Error('Unexpected public source response.');
    const declaredLength = Number(result.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Public source is too large.');
    if (!result.body) return '';
    reader = result.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Public source is too large.');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    // Keep network addresses and response bodies out of API error messages and logs.
    throw new Error('Public source could not be read.');
  } finally {
    clearTimeout(timeout);
    if (reader) void reader.cancel().catch(() => undefined);
  }
}

/** Convert source markup to display text; callers must still render it as text, never HTML. */
export function plainText(value: string, maxChars = 20_000): string {
  let text = value;
  for (let pass = 0; pass < 3; pass++) {
    text = decodeHTML(text)
      .replace(/<!--[^]*?(?:-->|$)/g, ' ')
      .replace(/<(script|style|iframe|object|noscript)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
  }
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, Math.max(0, Math.floor(maxChars))).join('').trimEnd();
}

/** XML has no reason to declare entities in either supported public feed. */
export function parsePublicXml(xml: string): unknown {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid public XML.');
  return new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
    parseTagValue: false, parseAttributeValue: false, trimValues: true,
    processEntities: true, allowBooleanAttributes: false,
  }).parse(xml) as unknown;
}
