import type { RequestContext } from "../server/session";
import { ApiError } from "../server/errors";
import { answerQuestion, assistantStatus } from "./service";
import { beginTurn, finishTurn } from "./conversations";
import type { AssistantEnvironment } from "./model";
import { fastingRecordSummary } from "./record-summary";
import { ASSISTANT_SUMMARY_QUESTION } from "./conversation-types";

export async function sendConversationTurn(context: RequestContext, roomId: string, body: Record<string, unknown>,
  options: { env?: AssistantEnvironment; fetch?: typeof fetch; loopbackRequest?: boolean } = {}) {
  if (Object.keys(body).some(key => !["id", "question", "expected_updated_at", "allow_model_processing"].includes(key))) {
    throw new ApiError(422, "INVALID_INPUT", "질문 내용을 확인해 주세요.");
  }
  if (body.allow_model_processing !== true) throw new ApiError(403, "AI_CONSENT_REQUIRED", "대화 내용을 AI로 처리하는 데 동의해 주세요.");
  if (!assistantStatus(context, options.env ?? process.env, options).available) throw new ApiError(503, "ASSISTANT_UNAVAILABLE", "도우미 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
  const started = await beginTurn(context, roomId, {
    id: body.id, question: body.question, expected_updated_at: body.expected_updated_at,
  });
  if (started.alreadyCompleted) return started.room;
  const history = started.room.turns.filter(turn => turn.id !== started.turn.id && turn.status === "completed" && turn.answer?.kind === "answer")
    .slice(-2).flatMap(turn => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer!.answer },
    ]);
  try {
    // A closed dialog/reloaded browser must not cancel a turn already saved to the account.
    // The model still has its own bounded timeout; finalization checks the attempt and room owner.
    const answer = await answerQuestion(context, { question: started.turn.question, allow_model_processing: true }, { ...options, history });
    return await finishTurn(context, roomId, started.turn.id, started.attemptId, answer, null);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "답변을 받지 못했어요. 다시 시도해 주세요.";
    await finishTurn(context, roomId, started.turn.id, started.attemptId, null, message).catch(() => undefined);
    throw error;
  }
}

export async function sendSummaryTurn(context: RequestContext, roomId: string, body: Record<string, unknown>, options: {
  revalidate: () => Promise<RequestContext>; signal?: AbortSignal; env?: AssistantEnvironment; now?: Date;
}) {
  if (Object.keys(body).some(key => !["id", "expected_updated_at", "allow_record_access", "allow_storage"].includes(key))) {
    throw new ApiError(422, "INVALID_INPUT", "기록 요약 요청을 확인해 주세요.");
  }
  if (body.allow_record_access !== true || body.allow_storage !== true) {
    throw new ApiError(403, "RECORD_ACCESS_CONSENT_REQUIRED", "공복 기록을 조회하고 요약 결과를 대화에 저장하는 데 동의해 주세요.");
  }
  if (!assistantStatus(context, options.env ?? process.env).recordSummaryAvailable) {
    throw new ApiError(503, "ASSISTANT_UNAVAILABLE", "기록 요약을 이용할 수 없어요. 이용 안내와 연결 상태를 확인해 주세요.");
  }
  const started = await beginTurn(context, roomId, { id: body.id, question: ASSISTANT_SUMMARY_QUESTION, expected_updated_at: body.expected_updated_at });
  if (started.alreadyCompleted) return started.room;
  try {
    // The calculation and stored snapshot never pass through answerQuestion or the model.
    const answer = await fastingRecordSummary(context, { allow_record_access: true }, options);
    if (options.signal?.aborted) throw new ApiError(499, "ASSISTANT_CANCELLED", "기록 요약을 중지했어요.");
    return await finishTurn(context, roomId, started.turn.id, started.attemptId, answer, null);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "기록 요약을 저장하지 못했어요. 다시 확인해 주세요.";
    await finishTurn(context, roomId, started.turn.id, started.attemptId, null, message).catch(() => undefined);
    throw error;
  }
}
