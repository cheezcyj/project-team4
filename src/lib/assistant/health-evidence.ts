import { createHash } from "node:crypto";
import { ApiError } from "../server/errors";
import { fetchPublicText, parsePublicXml, plainText } from "../server/public-content";
import type { KnowledgeMatch } from "./knowledge";

export const MEDLINEPLUS_RIGHTS_URL = "https://medlineplus.gov/about/using/usingcontent/";
export const MEDLINEPLUS_ATTRIBUTION = "Source: MedlinePlus, National Library of Medicine";

// Search uses only this public topic vocabulary. Neither the question nor account/profile data leaves the app.
const topics = [
  { id: "a1c", pattern: /당화혈색소|hba1c|a1c/i, term: 'title:"Blood Glucose"', title: "혈당과 당화혈색소", hints: /a1c|hemoglobin|average/i },
  { id: "labels", pattern: /무가당|영양\s*표시|식품\s*표시|설탕|당류|탄수화물/, term: 'title:"Carbohydrates"', title: "탄수화물과 당류", hints: /sugar|label|carbohydrate/i },
  { id: "diet", pattern: /식사|식단|식이|과일|채소|영양|주스|식후/, term: 'title:"Diabetic Diet"', title: "당뇨병과 식생활", hints: /meal|food|carbohydrate|fruit/i },
  { id: "exercise", pattern: /운동|걷기|걷는|산책|자전거|스트레칭|근력|유산소/, term: 'title:"Exercise and Physical Fitness"', title: "운동과 신체활동", hints: /activity|exercise|aerobic|strength/i },
  { id: "low-glucose", pattern: /저혈당/, term: 'title:"Hypoglycemia"', title: "저혈당", hints: /symptom|glucose|low/i },
  { id: "diabetes", pattern: /당뇨|혈당|인슐린/, term: 'title:"Diabetes"', title: "당뇨병과 혈당", hints: /glucose|insulin|diabetes/i },
  { id: "blood-pressure", pattern: /혈압|고혈압/, term: 'title:"High Blood Pressure"', title: "고혈압", hints: /pressure|prevent|risk/i },
  { id: "cholesterol", pattern: /콜레스테롤|고지혈|이상지질/, term: 'title:"Cholesterol"', title: "콜레스테롤", hints: /cholesterol|ldl|hdl/i },
  { id: "sleep", pattern: /수면|잠을|불면/, term: 'title:"Healthy Sleep"', title: "건강한 수면", hints: /sleep|habit/i },
  { id: "weight", pattern: /비만|체중|몸무게|다이어트/, term: 'title:"Weight Control"', title: "체중 관리", hints: /weight|habit|food/i },
  { id: "stress", pattern: /스트레스/, term: 'title:"Stress"', title: "스트레스", hints: /stress|manage/i },
  { id: "smoking", pattern: /흡연|담배|금연/, term: 'title:"Quitting Smoking"', title: "금연", hints: /quit|smok/i },
] as const;
type Topic = (typeof topics)[number];
type EvidenceOptions = { signal?: AbortSignal };
export type EvidenceSearch = (question: string, options?: EvidenceOptions) => Promise<KnowledgeMatch[]>;

export function healthTopicFor(question: string): Topic | null {
  return topics.find(topic => topic.pattern.test(question.normalize("NFKC"))) ?? null;
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];

function topicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    // The API also contains links to licensed encyclopedias, drug monographs and outside sites. Never follow them.
    if (url.protocol !== "https:" || url.hostname !== "medlineplus.gov" || url.username || url.password || url.port
      || url.search || url.hash || !/^\/[a-z0-9]+\.html$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function parseHealthEvidence(xml: string, topic: Topic, fetchedAt: string): KnowledgeMatch[] {
  const root = object(parsePublicXml(xml));
  const response = object(root.nlmSearchResult);
  if (!Object.keys(response).length || response.error) throw new Error("Invalid health topic response");
  const documents = list(object(response.list).document);
  return documents.flatMap(raw => {
    const document = object(raw);
    const url = topicUrl(document["@_url"]);
    if (!url) return [];
    const fields = list(document.content).map(object);
    const text = (name: string) => {
      const value = fields.find(field => field["@_name"] === name)?.["#text"];
      return typeof value === "string" ? value : "";
    };
    const title = plainText(text("title"), 200);
    const organization = plainText(text("organizationName"), 200);
    const summary = text("FullSummary");
    // Title search also returns related diseases. Only the exact curated topic is evidence.
    const expectedTitle = topic.term.slice('title:"'.length, -1);
    if (title.toLowerCase() !== expectedTitle.toLowerCase() || organization !== "National Library of Medicine" || !summary || summary.length > 80_000) return [];
    const paragraphs = summary.split(/<\/(?:p|ul|ol|h[1-6])\s*>/i).map(part => plainText(part, 4000)).filter(Boolean);
    const relevant = paragraphs.filter(paragraph => topic.hints.test(paragraph));
    // A1c is a specific subsection of Blood Glucose: sending glucose introductions,
    // unrelated treatment targets and bare headings adds CPU work without evidence for this topic.
    // Keep whole matching paragraphs (including their qualifications), never cut sentences.
    const selected = [...new Set(topic.id === "a1c" && relevant.length ? relevant : [paragraphs[0], ...relevant, ...paragraphs])].filter(Boolean);
    const excerpt: string[] = [];
    let length = 0;
    for (const paragraph of selected) {
      if (length + paragraph.length > 3600) continue;
      excerpt.push(paragraph); length += paragraph.length;
      if (excerpt.length >= 4) break;
    }
    if (!excerpt.length) return [];
    const id = `MEDLINE:${new URL(url).pathname.slice(1, -5)}`;
    return [{
      entry: {
        id, version: 1, topic: topic.id, language: "en", title: `${topic.title} · ${title}`,
        summary: excerpt.join("\n\n"), keywords: [],
        conditions: ["영문 건강 주제 요약의 뜻을 유지해 한국어로 짧게 설명합니다.", "개인 상태를 판단하거나 치료·약물 용량을 정하지 않습니다.", "질문에 답할 근거가 없으면 추측하지 않습니다."],
        content_sha256: createHash("sha256").update(summary).digest("hex"),
        status: "public-domain-source", approved_at: null, review_due_at: null, evidence: [],
      },
      citations: [{ id, title: `${topic.title} (${title})`, publisher: "MedlinePlus · 미국 국립의학도서관", url, pdfPages: [],
        attribution: MEDLINEPLUS_ATTRIBUTION, licenseLabel: "공개 건강 주제 요약", licenseUrl: MEDLINEPLUS_RIGHTS_URL, retrievedAt: fetchedAt }],
      score: 1,
    }];
  }).slice(0, 1);
}

export function createHealthEvidenceSearch(options: { fetch?: typeof fetch; now?: () => number } = {}): EvidenceSearch {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; matches: KnowledgeMatch[] }>();
  const pending = new Map<string, Promise<KnowledgeMatch[]>>();
  const failures = new Map<string, number>();
  const unavailable = () => new ApiError(503, "HEALTH_SOURCE_UNAVAILABLE", "건강정보 자료를 불러오지 못했어요. 잠시 후 다시 질문해 주세요.");
  return async (question, request = {}) => {
    if (request.signal?.aborted) throw new ApiError(499, "ASSISTANT_CANCELLED", "질문 처리를 중지했어요.");
    const topic = healthTopicFor(question);
    if (!topic) return [];
    const saved = cache.get(topic.id);
    if (saved && saved.expires > now()) return structuredClone(saved.matches);
    if ((failures.get(topic.id) ?? 0) > now()) throw unavailable();
    let work = pending.get(topic.id);
    if (!work) {
      work = (async () => {
        const url = new URL("https://wsearch.nlm.nih.gov/ws/query");
        url.search = new URLSearchParams({ db: "healthTopics", term: topic.term, retmax: "20", rettype: "brief", tool: "ieodream-health" }).toString();
        try {
          const xml = await fetchPublicText(url.href, { allowedHosts: ["wsearch.nlm.nih.gov"], fetch: options.fetch,
            timeoutMs: 8000, maxBytes: 512_000, accept: "application/xml, text/xml" });
          const matches = parseHealthEvidence(xml, topic, new Date(now()).toISOString());
          cache.set(topic.id, { matches, expires: now() + 12 * 60 * 60 * 1000 });
          failures.delete(topic.id);
          return matches;
        } catch {
          failures.set(topic.id, now() + 60_000);
          throw unavailable();
        } finally { pending.delete(topic.id); }
      })();
      pending.set(topic.id, work);
    }
    const result = await new Promise<KnowledgeMatch[]>((resolve, reject) => {
      const abort = () => reject(new ApiError(499, "ASSISTANT_CANCELLED", "질문 처리를 중지했어요."));
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) abort();
      work!.then(resolve, reject).finally(() => request.signal?.removeEventListener("abort", abort));
    });
    return structuredClone(result);
  };
}

export const findHealthEvidence = createHealthEvidenceSearch();
