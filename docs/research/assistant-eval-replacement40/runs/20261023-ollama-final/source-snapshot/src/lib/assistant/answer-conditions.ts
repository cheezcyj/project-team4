import type { KnowledgeMatch } from "./knowledge";

// 임상적 정확성 판정이 아닌, 현재 지식 요약의 필수 확인 항목 누락 검사예요.
// 보충 문구는 인용한 항목의 원래 summary만 사용하며 미인용 자료나 새 의료 지식을 넣지 않아요.
const required: Record<string, RegExp[]> = {
  B03: [/(?:메모|기록)만(?:으로)?[^.!?。]{0,60}원인[^.!?。]{0,15}(?:증명|확정|입증|단정)[^.!?。]{0,30}(?:못|없|어렵|불가)/u],
  N02: [/개인|자신|각자|사람마다/u, /섭취량|먹는양|드시는양|얼마나|(?:탄수화물|음식|식품)의?양|양(?:뿐|과|을|도)/u,
    /달라|다르|맞/u, /식이섬유/u],
  // ‘함량 기준’이라는 말만으로 수치·기준 단위의 누락을 통과시키지 않아요.
  N03: [/무가당/u, /제조|원재료|첨가/u, /무당/u,
    /(?<![\d.])100(?:g|그램)/iu, /(?<![\d.])100(?:ml|밀리리터)/iu, /(?<![\d.])0[.]5(?:g|그램)미만/u,
    /탄수화물/u, /당류/u, /기준량/u, /실제.{0,12}(?:양|섭취)|먹는양|드시는양/u],
  N04: [/식이섬유/u, /섭취량|먹는양|드시는양|양을.{0,6}(?:고려|확인|살펴)/u],
  X01: [/현재|몸상태|컨디션/u, /평소|활동수준/u, /계획/u],
  X02: [/벽밀기|팔들기/u, /운동제한|개인|본인|자신/u, /계획|전문가|안내/u],
  X04: [/의료진|담당의|의사/u, /활동능력|활동수준|운동능력/u, /복약|약물|복용/u, /식사/u, /제한/u],
};
// 이 두 설명이 불완전하면, 생성 문장과 요약이 상충하지 않도록 인용한 요약으로 대체해요.
const sourceOnlyOnMissing = new Set(["B03", "N03"]);

export function supplementAnswer(answer: string, citationIds: string[], matches: KnowledgeMatch[]) {
  const compact = answer.normalize("NFKC").replace(/\s+/gu, "");
  const cited = matches.filter(match => match.citations.some(citation => citationIds.includes(citation.id)));
  const missing = cited.filter(match => required[match.entry.id]?.some(pattern => !pattern.test(compact)));
  if (!missing.length) return { answer, sourceSupplemented: false };
  const sourceSummary = `참고 자료 요약: ${cited.map(match => match.entry.summary).join(" ")}`;
  const supplemented = missing.some(match => sourceOnlyOnMissing.has(match.entry.id)) ? sourceSummary
    : `${answer}\n\n참고 자료의 확인 사항: ${missing.map(match => match.entry.summary).join(" ")}`;
  // 긴 모델 답변 때문에 확인 사항이 잘리지 않도록, 이 경우에는 인용한 요약 전체를 표시해요.
  const result = supplemented.length <= 2000 ? supplemented
    : sourceSummary;
  if (result.length > 2000) throw new Error("Source summary exceeds answer limit");
  return { answer: result, sourceSupplemented: true };
}
