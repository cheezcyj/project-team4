import { contexts, type DateRange, type GlucoseRecord, type MeasurementContext, type RecordInput } from "./types";
import { isTimestamp } from "./dates";
import { mealSlots, type MealSlot } from './service-types';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// 허용한 입력만 새 객체로 만들어요. 사용자 번호 같은 추가 값은 저장 내용에 섞지 않아요.
export function validateRecord(
  input: unknown,
): { ok: true; value: RecordInput } | { ok: false; fields: Record<string, string> } {
  const data =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const fields: Record<string, string> = {};
  const rawValue = data.glucose_mg_dl;
  const numericValue =
    typeof rawValue === "string" && /^\d+$/.test(rawValue)
      ? Number(rawValue)
      : typeof rawValue === "number"
        ? rawValue
        : NaN;
  // 이 범위는 DB 정수 저장 한도예요. 혈당의 정상·위험 범위를 판단하는 기준은 아니에요.
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 2_147_483_647) {
    fields.glucose_mg_dl = "혈당을 1 이상 2,147,483,647 이하의 정수로 입력해 주세요.";
  }
  if (!isTimestamp(data.measured_at)) {
    fields.measured_at = "측정 날짜와 시간을 확인해 주세요.";
  }
  if (!contexts.some((context) => context.value === data.measurement_context)) {
    fields.measurement_context = "측정 시점을 선택해 주세요.";
  }
  let memo: string | null = null;
  const slot = data.meal_slot === '' || data.meal_slot === undefined ? null : data.meal_slot;
  if (slot !== null && (!mealSlots.some(item => item.value === slot) || !['before_meal','after_meal','after_meal_2h'].includes(String(data.measurement_context)))) {
    fields.meal_slot = '식사 시간대는 식전·식후 상황에서만 선택해 주세요.';
  }
  if (data.meal_memo !== undefined && data.meal_memo !== null) {
    if (typeof data.meal_memo !== "string") {
      fields.meal_memo = "메모를 글자로 입력해 주세요.";
    } else {
      memo = data.meal_memo.trim() || null;
      // 일부 이모지가 두 글자로 계산되는 일을 줄이도록, 코드 포인트(유니코드 문자 단위)로 세어요.
      if (memo && [...memo].length > 500) fields.meal_memo = "메모는 500자까지 입력할 수 있어요.";
    }
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      glucose_mg_dl: numericValue,
      measured_at: new Date(data.measured_at as string).toISOString(),
      measurement_context: data.measurement_context as MeasurementContext,
      meal_slot: slot as MealSlot | null,
      meal_memo: memo,
    },
  };
}

// 측정 시각이 같아도 고유 번호로 순서를 정해, 목록을 나눠 읽을 때 빠지거나 겹치지 않게 해요.
export function compareRecordsAscending(a: GlucoseRecord, b: GlucoseRecord): number {
  return Date.parse(a.measured_at) - Date.parse(b.measured_at) || a.id.localeCompare(b.id);
}

// 시작 시각은 포함하고 끝 시각은 빼서, 자정 기록이 두 날짜에 중복되지 않게 해요.
export function recordInRange(record: GlucoseRecord, range: DateRange): boolean {
  const time = Date.parse(record.measured_at);
  return time >= Date.parse(range.start) && time < Date.parse(range.end);
}
