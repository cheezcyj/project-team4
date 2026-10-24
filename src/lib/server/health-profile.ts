import { isTimestamp } from "../domain";
import { isHealthProfile, validateHealthProfile, type HealthProfile } from "../domain/health-profile";
import { ApiError, noConsent, unauthorized } from "./errors";
import { databaseError } from "./records";
import type { RequestContext } from "./session";

const COLUMNS = "user_id,sex,age,height_cm,weight_kg,notice_version,consented_at,created_at,updated_at";

function owner(context: RequestContext): string {
  if (!context.session.user) unauthorized();
  return context.session.user.id;
}

function normalize(value: unknown, userId: string): HealthProfile {
  if (!isHealthProfile(value, userId)) {
    throw new ApiError(503, "INVALID_DATA", "개인정보를 불러오지 못했어요. 다시 확인해 주세요.");
  }
  return value;
}

function profileDatabaseError(error: { code?: string }, mutation: boolean): never {
  if (["PT409", "40001", "23505"].includes(error.code ?? "")) {
    throw new ApiError(409, "STALE_PROFILE", "다른 화면에서 개인정보가 바뀌었어요. 최신 정보를 다시 불러와 주세요.");
  }
  databaseError(error, mutation);
}

export async function getHealthProfile(context: RequestContext): Promise<HealthProfile | null> {
  const userId = owner(context);
  if (context.store) return context.store.getHealthProfile(userId);
  const result = await context.supabase!.from("health_profiles").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (result.error) profileDatabaseError(result.error, false);
  return result.data ? normalize(result.data, userId) : null;
}

export async function saveHealthProfile(context: RequestContext, body: Record<string, unknown>): Promise<HealthProfile> {
  const userId = owner(context);
  if (context.session.consent !== "current") noConsent();
  const allowed = new Set(["sex", "age", "height_cm", "weight_kg", "allow_storage", "notice_version", "expected_updated_at"]);
  if (Object.keys(body).some(key => !allowed.has(key))) {
    throw new ApiError(422, "IMMUTABLE_FIELD", "변경할 수 없는 값이 포함되어 있어요.");
  }
  const result = validateHealthProfile(body);
  if (!result.ok) throw new ApiError(422, "INVALID_INPUT", "입력한 내용을 확인해 주세요.", result.fields);
  if (context.store) return context.store.saveHealthProfile(userId, result.value);
  const { expected_updated_at, ...profile } = result.value;
  const saved = await context.supabase!.rpc("save_health_profile", {
    p_profile: profile, p_expected_updated_at: expected_updated_at,
  });
  if (saved.error) profileDatabaseError(saved.error, true);
  return normalize(saved.data, userId);
}

export async function removeHealthProfile(context: RequestContext, body: Record<string, unknown>): Promise<void> {
  const userId = owner(context);
  if (Object.keys(body).some(key => key !== "expected_updated_at") || !isTimestamp(body.expected_updated_at)) {
    throw new ApiError(422, "INVALID_INPUT", "최신 정보를 불러온 뒤 삭제해 주세요.");
  }
  if (context.store) return context.store.removeHealthProfile(userId, body.expected_updated_at);
  const result = await context.supabase!.rpc("delete_health_profile", { p_expected_updated_at: body.expected_updated_at });
  if (result.error) profileDatabaseError(result.error, true);
}
