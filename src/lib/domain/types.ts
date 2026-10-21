// 화면과 서버가 함께 사용하는 기록·로그인 정보의 모양과 선택값이에요.
// 안내문 버전이 달라지면 기존 기록은 읽고 지울 수 있지만 새 저장은 막아요.
export const POLICY_VERSION = "demo-v3";

export const contexts = [
  { value: "fasting", label: "공복" },
  { value: "before_meal", label: "식전" },
  { value: "after_meal", label: "식후" },
  { value: "after_meal_2h", label: "식후 2시간" },
  { value: "on_waking", label: "기상 직후" },
  { value: "before_sleep", label: "취침 전" },
  { value: "nighttime", label: "야간" },
  { value: "before_exercise", label: "운동 전" },
  { value: "after_exercise", label: "운동 후" },
  { value: "other", label: "기타" },
] as const;

export type MeasurementContext = (typeof contexts)[number]["value"];
export type GlucoseRecord = {
  id: string;
  user_id: string;
  glucose_mg_dl: number;
  measured_at: string;
  measurement_context: MeasurementContext;
  meal_slot?: import('./service-types').MealSlot | null;
  import_batch_id?: string | null;
  source_row_number?: number | null;
  meal_memo: string | null;
  created_at: string;
  updated_at: string;
};
export type RecordInput = Pick<
  GlucoseRecord,
  "glucose_mg_dl" | "measured_at" | "measurement_context" | "meal_slot" | "meal_memo"
>;
export type DateRange = { start: string; end: string; label: string };
export type ConsentStatus = "current" | "missing" | "outdated";
export type AppSession = {
  user: { id: string; email: string } | null;
  mode: "demo" | "supabase" | "unconfigured";
  consent: ConsentStatus | null;
};
