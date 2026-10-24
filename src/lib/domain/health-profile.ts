import { isTimestamp } from "./dates";
import { isUuid } from "./records";

export const HEALTH_PROFILE_NOTICE_VERSION = "health-profile-v1";
export type HealthProfileSex = "female" | "male" | "other";

export type HealthProfileValues = {
  sex: HealthProfileSex | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
};

export type HealthProfileInput = HealthProfileValues & {
  allow_storage: true;
  notice_version: typeof HEALTH_PROFILE_NOTICE_VERSION;
  expected_updated_at: string | null;
};

export type HealthProfile = HealthProfileValues & {
  user_id: string;
  notice_version: typeof HEALTH_PROFILE_NOTICE_VERSION;
  consented_at: string;
  created_at: string;
  updated_at: string;
};

/** 저장 범위만 검사하며, 수치를 정상·위험 여부로 판단하지 않아요. */
export function validateHealthProfile(
  input: unknown,
): { ok: true; value: HealthProfileInput } | { ok: false; fields: Record<string, string> } {
  const data = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const fields: Record<string, string> = {};
  const sex = data.sex ?? null;
  const age = data.age ?? null;
  const height = data.height_cm ?? null;
  const weight = data.weight_kg ?? null;

  if (sex !== null && (typeof sex !== "string" || !["female", "male", "other"].includes(sex))) {
    fields.sex = "성별을 목록에서 선택해 주세요.";
  }
  if (age !== null && (typeof age !== "number" || !Number.isInteger(age) || age < 0 || age > 120)) {
    fields.age = "나이는 0~120 사이의 정수로 입력해 주세요.";
  }
  if (height !== null && (typeof height !== "number" || !Number.isFinite(height)
    || height < 30 || height > 250 || Math.round(height * 10) / 10 !== height)) {
    fields.height_cm = "키는 30~250cm 사이에서 소수 첫째 자리까지 입력해 주세요.";
  }
  if (weight !== null && (typeof weight !== "number" || !Number.isFinite(weight)
    || weight < 1 || weight > 500 || Math.round(weight * 10) / 10 !== weight)) {
    fields.weight_kg = "몸무게는 1~500kg 사이에서 소수 첫째 자리까지 입력해 주세요.";
  }
  if (sex === null && age === null && height === null && weight === null) {
    fields.profile = "한 가지 이상 입력해 주세요. 저장된 정보를 비우려면 삭제해 주세요.";
  }
  if (data.allow_storage !== true) fields.allow_storage = "개인정보 저장 안내에 동의해 주세요.";
  if (data.notice_version !== HEALTH_PROFILE_NOTICE_VERSION) {
    fields.notice_version = "최신 개인정보 저장 안내를 확인해 주세요.";
  }
  if (data.expected_updated_at !== null && !isTimestamp(data.expected_updated_at)) {
    fields.expected_updated_at = "최신 정보를 불러온 뒤 저장해 주세요.";
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: {
    sex: sex as HealthProfileSex | null,
    age: age as number | null,
    height_cm: height as number | null,
    weight_kg: weight as number | null,
    allow_storage: true,
    notice_version: HEALTH_PROFILE_NOTICE_VERSION,
    // DB가 반환한 마이크로초를 보존해야 오래된 화면의 변경을 정확히 구분해요.
    expected_updated_at: data.expected_updated_at as string | null,
  } };
}

export function isHealthProfile(value: unknown, owner?: string): value is HealthProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as HealthProfile;
  return isUuid(row.user_id) && (!owner || row.user_id === owner)
    && ["sex", "age", "height_cm", "weight_kg"].every(key => key in row)
    && isTimestamp(row.consented_at) && isTimestamp(row.created_at) && isTimestamp(row.updated_at)
    && validateHealthProfile({ ...row, allow_storage: true, expected_updated_at: null }).ok;
}
