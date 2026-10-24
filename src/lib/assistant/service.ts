import type { RequestContext } from "../server/session";
import { ApiError, unauthorized } from "../server/errors";
import { eligibleKnowledge, retrieveKnowledge } from "./knowledge";
import { generateAnswer, modelSettings, type AssistantEnvironment, type ModelHistoryMessage } from "./model";
import { medicalBoundary } from "./safety";
import { supplementAnswer } from "./answer-conditions";
import { draftPreviewAllowed } from "./preview";
import { ASSISTANT_MAX_QUESTION_LENGTH, type AssistantAnswer, type AssistantStatus } from "./types";

const activeUsers = new Set<string>();
const noEvidence = "확인한 자료 안에서 이 질문에 답할 근거를 찾지 못했어요. 질문을 구체적으로 적거나 공식 자료·의료진에게 확인해 주세요.";

function configuration(context: RequestContext, env: AssistantEnvironment, loopbackRequest = false) {
  if (!context.session.user) unauthorized();
  const draftPreview = draftPreviewAllowed(context, env, loopbackRequest);
  const candidates = eligibleKnowledge(draftPreview);
  const settings = modelSettings(env);
  return { draftPreview, candidates, settings, available: env.ASSISTANT_ENABLED === "1" && !!settings && candidates.length > 0 };
}

export function assistantStatus(context: RequestContext, env: AssistantEnvironment = process.env,
  options: { loopbackRequest?: boolean } = {}): AssistantStatus {
  const config = configuration(context, env, options.loopbackRequest === true);
  return { available: config.available, draftPreview: config.available && config.draftPreview,
    recordSummaryAvailable: env.ASSISTANT_ENABLED === "1" && context.session.consent === "current",
    message: config.available ? "일반 건강정보를 질문할 수 있어요. 공복 기록 요약은 별도 동의 후 버튼으로 확인해 주세요."
      : env.ASSISTANT_ENABLED === "1" && context.session.consent === "current" ? "공복 기록을 요약할 수 있어요. 일반 건강정보 답변은 연결을 준비하고 있어요."
      : "도우미 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요." };
}

function unsupportedQuestion(question: string): Pick<AssistantAnswer, "kind" | "answer"> | null {
  const medical = medicalBoundary(question);
  if (medical) return medical;
  question = question.normalize("NFKC").toLocaleLowerCase("ko");
  if (/(?:내|제|나의|저의)\s*(?:혈당|당화혈색소|기록|검사|리포트)|(?:어제|지난|최근).{0,25}(?:혈당|기록|비교|변화|평균|요약)/u.test(question)) {
    return { kind: "unsupported", answer: "이 질문으로 개인 기록을 조회하지 않았어요. 최근 7일 공복 기록은 별도 동의 후 ‘공복 기록 요약’ 버튼으로 확인할 수 있어요. 개인 수치 해석이나 다른 기간 비교는 아직 지원하지 않아요." };
  }
  if (/(?:오늘|점심|저녁).{0,15}(?:뭐.{0,3}먹|추천|식단\s*짜)/u.test(question)) {
    return { kind: "unsupported", answer: "개인에게 맞춘 식단 추천은 아직 지원하지 않아요. 식사 구성이나 영양표시 등 일반적인 식생활 정보는 질문할 수 있어요." };
  }
  return null;
}

export async function answerQuestion(context: RequestContext, body: Record<string, unknown>,
  options: { env?: AssistantEnvironment; signal?: AbortSignal; fetch?: typeof fetch; loopbackRequest?: boolean;
    history?: ModelHistoryMessage[] } = {}): Promise<AssistantAnswer> {
  const config = configuration(context, options.env ?? process.env, options.loopbackRequest === true);
  if (Object.keys(body).some(key => !["question", "allow_model_processing"].includes(key))
    || typeof body.question !== "string" || !body.question.trim() || [...body.question].length > ASSISTANT_MAX_QUESTION_LENGTH) {
    throw new ApiError(422, "INVALID_INPUT", `질문은 1자 이상 ${ASSISTANT_MAX_QUESTION_LENGTH}자 이하로 적어 주세요.`);
  }
  if (body.allow_model_processing !== true) throw new ApiError(403, "AI_CONSENT_REQUIRED", "질문을 AI로 처리하는 안내를 확인하고 동의해 주세요.");
  if (!config.available || !config.settings) throw new ApiError(503, "ASSISTANT_UNAVAILABLE", "도우미 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
  const question = body.question.trim();
  const unsupported = unsupportedQuestion(question);
  if (unsupported) return { ...unsupported, citations: [], draftPreview: config.draftPreview };
  let matches = retrieveKnowledge(question, config.candidates);
  // Resolve an explicit follow-up from server-owned questions. Unrelated questions still abstain.
  if (!matches.length && /그건|그거|그것|(?:그|이|해당|앞서|방금|아까|이전)\s*(?:검사|내용|말|방법|정보|기준|운동|식사)|더\s*(?:자세|알려|설명)/u.test(question)) {
    const previous = [...(options.history ?? [])].reverse().find(message => message.role === "user"
      && retrieveKnowledge(message.content, config.candidates).length > 0);
    if (previous) matches = retrieveKnowledge(`${previous.content}\n${question}`, config.candidates);
  }
  if (!matches.length) return { kind: "no_evidence", answer: noEvidence, citations: [], draftPreview: config.draftPreview };
  const user = context.session.user!.id;
  if (activeUsers.has(user) || activeUsers.size >= 4) throw new ApiError(429, "ASSISTANT_BUSY", "진행 중인 답변이 있어요. 잠시 후 다시 질문해 주세요.");
  activeUsers.add(user);
  try {
    const result = await generateAnswer(question, matches, config.settings, options);
    if (!result.citationIds.length) return { kind: "no_evidence", answer: noEvidence, citations: [], draftPreview: config.draftPreview };
    return { kind: "answer", ...supplementAnswer(result.answer, result.citationIds, matches), draftPreview: config.draftPreview,
      citations: matches.flatMap(match => match.citations).filter(citation => result.citationIds.includes(citation.id)) };
  } finally { activeUsers.delete(user); }
}
