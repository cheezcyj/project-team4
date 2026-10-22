import {
  POLICY_VERSION,
  dayRange,
  isTimestamp,
  isUuid,
  recentRange,
  queryRange,
  validateRecord,
  type GlucoseRecord,
  type RecordInput,
  type RangeQuery,
} from "../domain";
import { ApiError, noConsent, notFound } from "./errors";
import type { RequestContext } from "./session";

const COLUMNS = "id,user_id,glucose_mg_dl,measured_at,measurement_context,meal_slot,meal_memo,created_at,updated_at,import_batch_id,source_row_number";

function userId(context: RequestContext): string {
  // 요청 본문의 user_id가 아니라 서버가 확인한 로그인 사용자만 소유자로 사용해요.
  return context.session.user!.id;
}

function checkRecord(value: unknown, owner: string): GlucoseRecord {
  // DB에서 온 값도 형식과 소유자를 확인해 잘못된 기록이 그래프에 섞이지 않게 해요.
  const row = value as GlucoseRecord;
  if (
    !row ||
    !isUuid(row.id) ||
    row.user_id !== owner ||
    typeof row.glucose_mg_dl !== "number" ||
    !isTimestamp(row.created_at) ||
    !isTimestamp(row.updated_at) ||
    !validateRecord(row).ok
  ) {
    throw new ApiError(503, "INVALID_DATA", "기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
  }
  return row;
}

type DbError = { code?: string; message?: string; status?: number };
export function databaseError(error: DbError, mutation: boolean): never {
  if (error.code === 'PT409' || error.code === '40001') throw new ApiError(409,'STALE_RECORD','다른 화면에서 기록이 바뀌었어요. 최신 기록을 확인해 주세요.');
  if (error.code === 'P0002') notFound();
  if (error.code === "42501") {
    throw new ApiError(403, "PERMISSION_DENIED", "기록을 변경할 권한이 없어요. 로그인과 동의 상태를 확인해 주세요.");
  }
  if (error.code === "23505") {
    throw new ApiError(409, "RECORD_EXISTS", "같은 기록 번호가 이미 있어요. 저장된 기록을 확인해 주세요.");
  }
  if (["23514", "22001", "22003", "22007", "22008", "22009", "22P02", "23502"].includes(error.code ?? "")) {
    throw new ApiError(422, "INVALID_INPUT", "입력한 내용을 다시 확인해 주세요.");
  }
  if (error.code === "PGRST301" || error.code === "PGRST303") {
    throw new ApiError(401, "UNAUTHORIZED", "다시 로그인해 주세요.");
  }
  throw new ApiError(
    503,
    mutation ? "UNKNOWN_OUTCOME" : "DATA_UNAVAILABLE",
    mutation ? "변경 결과를 확인하지 못했어요. 기록을 다시 확인해 주세요." : "기록을 불러오지 못했어요. 다시 시도해 주세요.",
  );
}

function parseInput(body: Record<string, unknown>): RecordInput {
  const validation = validateRecord(body);
  if (!validation.ok) {
    throw new ApiError(422, "INVALID_INPUT", "입력한 내용을 확인해 주세요.", validation.fields);
  }
  // 소유자와 저장 시각은 서버·DB가 정해요. 화면에서 보낸 값으로 바꿀 수 없어요.
  for (const key of ["user_id", "created_at", "updated_at", "import_batch_id", "source_row_number"]) {
    if (key in body) {
      throw new ApiError(422, "IMMUTABLE_FIELD", "변경할 수 없는 값이 포함되어 있어요.");
    }
  }
  return validation.value;
}

export async function listRecords(context: RequestContext, date: string | null | RangeQuery) {
  let range;
  try {
    range = typeof date === 'object' && date !== null ? queryRange(date) : date === null ? recentRange() : dayRange(date);
  } catch {
    throw new ApiError(422, "INVALID_DATE", "날짜를 확인해 주세요.");
  }
  if (context.store) return { records: await context.store.list(userId(context), range), range };
  const records: GlucoseRecord[] = [];
  const seen = new Set<string>();
  let cursor: GlucoseRecord | undefined;
  // 같은 시각의 기록도 빠뜨리지 않도록 측정 시각과 기록 번호를 함께 이어서 조회해요.
  while (true) {
    let query = context.supabase!
      .from("glucose_records")
      .select(COLUMNS)
      .eq("user_id", userId(context))
      .gte("measured_at", range.start)
      .lt("measured_at", range.end)
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200);
    if (cursor) {
      // 검색 조건에 넣는 값은 검사한 DB 기록에서만 가져오고 사용자의 검색 문장은 넣지 않아요.
      query = query.or(`measured_at.gt.${cursor.measured_at},and(measured_at.eq.${cursor.measured_at},id.gt.${cursor.id})`);
    }
    const result = await query;
    if (result.error) databaseError(result.error, false);
    if (!result.data?.length) break;
    for (const value of result.data) {
      const record = checkRecord(value, userId(context));
      if (seen.has(record.id)) {
        throw new ApiError(503, "INCOMPLETE_DATA", "기록 전체를 확인하지 못했어요. 다시 불러와 주세요.");
      }
      seen.add(record.id);
      records.push(record);
      cursor = record;
    }
    // 서버가 요청한 200개보다 적게 돌려줘도 다음 묶음을 확인해 전체 목록이 잘리지 않게 해요.
  }
  return { records: records.reverse(), range };
}

export async function getRecord(context: RequestContext, id: string): Promise<GlucoseRecord> {
  if (!isUuid(id)) notFound();
  if (context.store) return context.store.get(userId(context), id);
  const result = await context.supabase!
    .from("glucose_records")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", userId(context))
    .maybeSingle();
  if (result.error) databaseError(result.error, false);
  if (!result.data) notFound();
  return checkRecord(result.data, userId(context));
}

export async function insertRecord(context: RequestContext, body: Record<string, unknown>): Promise<GlucoseRecord> {
  if (!isUuid(body.id)) {
    throw new ApiError(422, "INVALID_INPUT", "기록 번호를 확인하지 못했어요. 입력 화면을 다시 열어 주세요.");
  }
  if (context.session.consent !== "current") noConsent();
  const input = parseInput(body);
  if (context.store) return context.store.insert(userId(context), body.id, input);
  const result = await context.supabase!
    .from("glucose_records")
    .insert({ ...input, id: body.id, user_id: userId(context) })
    .select(COLUMNS)
    .single();
  if (result.error) databaseError(result.error, true);
  return checkRecord(result.data, userId(context));
}

export async function updateRecord(
  context: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<GlucoseRecord> {
  if (!isUuid(id)) notFound();
  const input = parseInput(body);
  if ("id" in body && body.id !== id) throw new ApiError(422, "IMMUTABLE_FIELD", "기록 번호는 변경할 수 없어요.");
  if (!isTimestamp(body.expected_updated_at)) {
    throw new ApiError(422, "INVALID_INPUT", "최신 기록을 불러온 뒤 수정해 주세요.");
  }
  // 없는 기록과 다른 사람의 기록은 같은 응답을 보내 존재 여부를 드러내지 않아요.
  await getRecord(context, id);
  if (context.session.consent !== "current") noConsent();
  if (context.store) return context.store.update(userId(context), id, input, body.expected_updated_at);
  const result = await context.supabase!
    .from("glucose_records")
    .update(input)
    .eq("id", id)
    .eq("user_id", userId(context))
    // 화면을 연 뒤 다른 곳에서 수정했다면 덮어쓰지 않고 최신 내용을 다시 확인하게 해요.
    .eq("updated_at", body.expected_updated_at)
    .select(COLUMNS)
    .maybeSingle();
  if (result.error) databaseError(result.error, true);
  if (!result.data) {
    await getRecord(context, id);
    throw new ApiError(409, "STALE_RECORD", "다른 화면에서 기록이 바뀌었어요. 최신 기록을 확인해 주세요.");
  }
  return checkRecord(result.data, userId(context));
}

export async function removeRecord(context: RequestContext, id: string): Promise<void> {
  // 동의 안내가 바뀌어도 본인의 기존 기록을 삭제할 권리는 유지해요.
  if (!isUuid(id)) notFound();
  if (context.store) return context.store.remove(userId(context), id);
  const result = await context.supabase!
    .from("glucose_records")
    .delete()
    .eq("id", id)
    .eq("user_id", userId(context))
    .select("id");
  if (result.error) databaseError(result.error, true);
  if (!result.data?.length) notFound();
}

export async function agree(context: RequestContext, body: Record<string, unknown>): Promise<void> {
  if (body.agreed !== true) {
    throw new ApiError(422, "AGREEMENT_REQUIRED", "안내를 읽고 동의 항목을 선택해 주세요.");
  }
  if (context.store) return context.store.agree(userId(context));
  if (context.session.consent === "current") return;
  if (context.session.consent === "outdated") {
    throw new ApiError(409, "POLICY_OUTDATED", "이 계정의 동의 안내가 변경되었어요. 관리자에게 문의해 주세요.");
  }
  const result = await context.supabase!
    .from("user_consents")
    .insert({ user_id: userId(context), policy_version: POLICY_VERSION });
  if (result.error) databaseError(result.error, true);
}
