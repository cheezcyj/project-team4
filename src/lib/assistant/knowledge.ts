import { createHash } from "node:crypto";
import bundle from "../../../docs/research/chatbot_v5/knowledge.json";
import type { AssistantCitation } from "./types";

export type KnowledgeEntry = {
  id: string; version: number; topic: string; language: string; title: string; summary: string;
  keywords: string[]; conditions: string[]; content_sha256: string; status: string;
  approved_at: string | null; review_due_at: string | null;
  evidence: { source_id: string; section: string; role: string; pdf_pages?: number[]; printed_pages?: number[] }[];
};
export type KnowledgeBundle = {
  policy: { runtime_publishable: boolean };
  approval: { team_content_approved: boolean; medical_review_completed: boolean; source_reuse_review_completed: boolean };
  knowledge_entries: KnowledgeEntry[];
  sources: { id: string; kind: string; title: string; publisher: string; canonical_url: string;
    pdf_page_count?: number; status: string; approved_at?: string | null; permitted_runtime_reuse?: boolean | null }[];
};
export type KnowledgeMatch = { entry: KnowledgeEntry; citations: AssistantCitation[]; score: number };

// Python 준비 도구와 같은 키 정렬을 사용해 내용 해시를 확인해요.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return `{${Object.keys(fields).sort().map(key => `${JSON.stringify(key)}:${canonical(fields[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(entry: KnowledgeEntry): string {
  const { version, topic, language, title, summary, keywords, evidence, conditions } = entry;
  return createHash("sha256").update(canonical({ version, topic, language, title, summary, keywords, evidence, conditions })).digest("hex");
}

function validApproval(value: unknown, now: number): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
}

// 초안 허용은 호출부가 로컬 가상 계정 모드에서만 결정해요. 원본 승인 상태는 바꾸지 않아요.
export function eligibleKnowledge(preview: boolean, now = Date.now(), data: KnowledgeBundle = bundle): KnowledgeMatch[] {
  const approvedBundle = data.policy.runtime_publishable === true && data.approval.team_content_approved
    && data.approval.medical_review_completed && data.approval.source_reuse_review_completed;
  if (!preview && !approvedBundle) return [];
  const seen = new Set<string>();
  return data.knowledge_entries.flatMap(entry => {
    if (seen.has(entry.id)) return [];
    seen.add(entry.id);
    if (contentHash(entry) !== entry.content_sha256) return [];
    if (!preview && (entry.status !== "approved" || !validApproval(entry.approved_at, now)
      || typeof entry.review_due_at !== "string" || Date.parse(entry.review_due_at) <= now
      || !Number.isFinite(Date.parse(entry.review_due_at)))) return [];
    const citations: AssistantCitation[] = [];
    for (const evidence of entry.evidence) {
      const source = data.sources.find(item => item.id === evidence.source_id);
      if (!source || source.kind !== "official_health_reference" || !("pdf_page_count" in source)) return [];
      if (!preview && (source.status !== "approved" || !("approved_at" in source)
        || !validApproval(source.approved_at, now) || !("permitted_runtime_reuse" in source)
        || source.permitted_runtime_reuse !== true)) return [];
      try {
        if (new URL(source.canonical_url).protocol !== "https:") return [];
      } catch { return []; }
      if (!evidence.pdf_pages?.length || evidence.pdf_pages.some(page => !Number.isInteger(page) || page < 1 || page > source.pdf_page_count!)) return [];
      citations.push({ id: `${entry.id}:${source.id}`, title: source.title, publisher: source.publisher,
        url: source.canonical_url, pdfPages: evidence.pdf_pages });
    }
    return citations.length ? [{ entry, citations, score: 0 }] : [];
  });
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko").replace(/hba1c/g, "당화혈색소").replace(/[^\p{L}\p{N}]/gu, "");
}

const broadKeywords = new Set(["혈당", "기록", "비교", "평균", "밥", "곡류", "현미", "채소", "인슐린", "저혈당"]);
const exerciseContext = /운동|걷기|걷는|걸어|산책|자전거|탄력밴드|스트레칭|유산소|근력|달리기|신체활동/u;

// 작은 자료집의 검색 기준선이에요. 임베딩 검색으로 교체해도 답변·출처 계약은 같아요.
export function retrieveKnowledge(question: string, candidates: KnowledgeMatch[], limit = 3): KnowledgeMatch[] {
  const query = normalize(question);
  return candidates.map(match => {
    // 운동 자료에 함께 등장하는 합병증·혈당 수치·30분만으로 운동 질문이라고 추정하지 않아요.
    if (match.entry.topic === "exercise" && !exerciseContext.test(query)) return { ...match, score: 0 };
    const matched = match.entry.keywords.filter(keyword => query.includes(normalize(keyword)));
    if (!matched.some(keyword => !broadKeywords.has(normalize(keyword)))) return { ...match, score: 0 };
    const score = matched.reduce((total, keyword) => {
      const normalized = normalize(keyword);
      const frequency = candidates.filter(item => item.entry.keywords.some(word => normalize(word) === normalized)).length;
      return total + Math.log(1 + candidates.length / frequency) * Math.min(normalized.length, 8);
    }, 0);
    return { ...match, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit);
}
