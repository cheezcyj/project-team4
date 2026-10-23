import { recentRange, recordInRange, seoulDay, summarizeGlucose, type GlucoseRecord } from "../domain";
import { ApiError, unauthorized } from "../server/errors";
import { listRecords } from "../server/records";
import type { RequestContext } from "../server/session";
import type { AssistantEnvironment } from "./model";
import type { AssistantAnswer, FastingRecordSummary } from "./types";

function requireAccess(context: RequestContext): string {
  if (!context.session.user) unauthorized();
  if (context.session.consent !== "current") {
    throw new ApiError(403, "RECORD_CONSENT_REQUIRED", "현재 서비스 이용 안내에 동의한 뒤 기록 요약을 이용해 주세요.");
  }
  return context.session.user.id;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ApiError(499, "ASSISTANT_CANCELLED", "기록 요약을 중지했어요.");
}

// 평균은 측정 건수 기준이에요. 같은 날 여러 건을 하루 평균 한 건으로 바꾸지 않아요.
export function summarizeFastingRecords(records: GlucoseRecord[], owner: string, now = new Date()): FastingRecordSummary {
  const range = recentRange(now);
  const selected = records.filter(record => record.user_id === owner && record.measurement_context === "fasting"
    && recordInRange(record, range) && Date.parse(record.measured_at) <= now.getTime());
  const stats = summarizeGlucose(selected);
  const recordedDays = new Set(selected.map(record => seoulDay(record.measured_at))).size;
  return { range, asOf: now.toISOString(), timezone: "Asia/Seoul", measurementContext: "fasting", unit: "mg/dL",
    count: stats.count, recordedDays, missingDays: 7 - recordedDays,
    average: stats.average === null ? null : Math.round(stats.average * 10) / 10, min: stats.min, max: stats.max };
}

function describe(summary: FastingRecordSummary): string {
  const period = `${summary.range.label} (한국시간·오늘 현재까지)`;
  if (!summary.count) return `${period}에 저장된 공복 기록이 없어요. 평균·최솟값·최댓값은 계산하지 않았어요. 미기록일을 혈당 0으로 처리하지 않아요.`;
  return `${period} 공복 기록은 ${summary.count}건(${summary.recordedDays}일)이에요. 측정 건수 기준 평균 ${summary.average} mg/dL, 최솟값 ${summary.min} mg/dL, 최댓값 ${summary.max} mg/dL이에요. 공복 기록이 없는 ${summary.missingDays}일은 계산에서 제외했으며, 평균은 소수 첫째 자리까지 반올림했어요. 저장된 값의 요약이며 정상 여부·호전 여부·변화 원인을 판단한 결과는 아니에요.`;
}

export async function fastingRecordSummary(context: RequestContext, body: Record<string, unknown>, options: {
  revalidate: () => Promise<RequestContext>; signal?: AbortSignal; now?: Date; env?: AssistantEnvironment;
}): Promise<AssistantAnswer> {
  const owner = requireAccess(context);
  if (Object.keys(body).some(key => key !== "allow_record_access")) {
    throw new ApiError(422, "INVALID_INPUT", "기록 요약 요청을 확인해 주세요.");
  }
  if (body.allow_record_access !== true) {
    throw new ApiError(403, "RECORD_ACCESS_CONSENT_REQUIRED", "이번 요약을 위해 본인의 최근 7일 공복 기록을 조회하는 데 동의해 주세요.");
  }
  if ((options.env ?? process.env).ASSISTANT_ENABLED !== "1") {
    throw new ApiError(503, "ASSISTANT_UNAVAILABLE", "도우미 연결을 준비하고 있어요.");
  }
  checkCancelled(options.signal);
  const now = options.now ?? new Date();
  const range = recentRange(now);
  const { records } = await listRecords(context, { start: seoulDay(range.start), end: seoulDay(now) });
  // 조회 중 로그아웃·계정 변경·서비스 동의 변경을 다시 확인해요. 요청별 기록 동의는 저장하지 않아요.
  const latest = await options.revalidate();
  if (requireAccess(latest) !== owner) unauthorized();
  checkCancelled(options.signal);
  const recordSummary = summarizeFastingRecords(records, owner, now);
  return { kind: "record_summary", answer: describe(recordSummary), citations: [], draftPreview: false, recordSummary };
}
