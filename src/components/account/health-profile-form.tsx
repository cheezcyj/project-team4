"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  HEALTH_PROFILE_NOTICE_VERSION,
  isHealthProfile,
  validateHealthProfile,
  type HealthProfile,
  type HealthProfileSex,
} from "@/lib/domain/health-profile";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { clearDraft, readDraft, saveDraft } from "@/lib/client/form-memory";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState, InlineError, LoadingState } from "@/components/ui/page-parts";
import styles from "./health-profile.module.css";

export const HEALTH_PROFILE_DRAFT_KEY = "health-profile";
export type HealthProfileFormState = { dirty: boolean; pending: boolean; uncertain: boolean };
type Values = { sex: HealthProfileSex | ""; age: string; height_cm: string; weight_kg: string };
type Outcome = "save" | "delete" | "conflict" | null;
type ProfileDraft = { values: Values; profile: HealthProfile | null; allowStorage: boolean };
const empty = (): Values => ({ sex: "", age: "", height_cm: "", weight_kg: "" });
const fromProfile = (profile: HealthProfile | null): Values => profile ? {
  sex: profile.sex ?? "", age: profile.age === null ? "" : String(profile.age),
  height_cm: profile.height_cm === null ? "" : String(profile.height_cm),
  weight_kg: profile.weight_kg === null ? "" : String(profile.weight_kg),
} : empty();
const numberValue = (value: string) => value.trim() === "" ? null : /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
const fieldsInOrder = ["sex", "age", "height_cm", "weight_kg", "allow_storage"];
const focusError = (errors: Record<string, string>) => {
  const field = errors.profile ? "sex" : fieldsInOrder.find(name => errors[name]) ?? "sex";
  requestAnimationFrame(() => document.getElementById(`profile-${field}`)?.focus());
};
const sameValues = (values: Values, profile: HealthProfile | null) => {
  if (!profile) return false;
  return (values.sex || null) === profile.sex && numberValue(values.age) === profile.age
    && numberValue(values.height_cm) === profile.height_cm && numberValue(values.weight_kg) === profile.weight_kg;
};

export function HealthProfileForm({ userId, canSave, disabled = false, onStateChange, onConsentOpen }: {
  userId: string;
  canSave: boolean;
  disabled?: boolean;
  onStateChange: (state: HealthProfileFormState) => void;
  onConsentOpen: () => void;
}) {
  const [values, setValues] = useState<Values>(empty);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [allowStorage, setAllowStorage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<"save" | "delete" | "check" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [showStored, setShowStored] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const pending = operation !== null;
  const dirty = !loading && !loadError && (JSON.stringify(values) !== JSON.stringify(fromProfile(profile)) || allowStorage);
  const locked = disabled || pending || outcome !== null;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      setLoading(true); setLoadError("");
      try {
        const result = await api<{ profile: HealthProfile | null }>("/api/profile");
        if (!active) return;
        if (result.profile !== null && !isHealthProfile(result.profile, userId)) throw new Error("개인정보를 확인하지 못했어요. 다시 불러와 주세요.");
        const savedDraft = readDraft(HEALTH_PROFILE_DRAFT_KEY, userId);
        const draft = savedDraft?.values as ProfileDraft | undefined;
        setProfile(draft ? draft.profile : result.profile);
        setValues(draft ? draft.values : fromProfile(result.profile));
        setAllowStorage(draft?.allowStorage ?? false);
        setOutcome((savedDraft?.unknown as Outcome) ?? null);
      } catch (cause) { if (active) setLoadError(errorMessage(cause)); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [userId, retry]);
  useEffect(() => {
    onStateChange({ dirty, pending, uncertain: outcome !== null });
  }, [dirty, pending, outcome, onStateChange]);
  useEffect(() => {
    if (loading || loadError) return;
    if (dirty || outcome) saveDraft(HEALTH_PROFILE_DRAFT_KEY, { userId, values: { values, profile, allowStorage }, recordId: "profile", unknown: outcome });
    else clearDraft(HEALTH_PROFILE_DRAFT_KEY);
  }, [loading, loadError, dirty, outcome, userId, values, profile, allowStorage]);

  const update = (name: keyof Values, value: string) => {
    setValues(current => ({ ...current, [name]: value }));
    setFields(current => { const next = { ...current }; delete next[name]; delete next.profile; return next; });
    setError(""); setNotice("");
  };
  const keepDraft = (unknown: Outcome) => saveDraft(HEALTH_PROFILE_DRAFT_KEY, {
    userId, values: { values, profile, allowStorage }, recordId: "profile", unknown,
  });
  const saved = (next: HealthProfile | null, message: string) => {
    setProfile(next); setValues(fromProfile(next)); setAllowStorage(false); setOutcome(null);
    setShowStored(false); setFields({}); setError(""); setNotice(message);
    clearDraft(HEALTH_PROFILE_DRAFT_KEY);
    if (next === null) requestAnimationFrame(() => document.getElementById("health-profile-title")?.focus());
  };
  const fail = (cause: unknown, action: "save" | "delete") => {
    setError(errorMessage(cause));
    if (cause instanceof RequestError) {
      if (cause.fields) { setFields(cause.fields); focusError(cause.fields); }
      const next = cause.status === 409 ? "conflict" : cause.code === "UNKNOWN_OUTCOME" ? action : null;
      setOutcome(next); keepDraft(next);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || locked || !canSave) return;
    setError(""); setNotice("");
    const validation = validateHealthProfile({
      sex: values.sex || null, age: numberValue(values.age), height_cm: numberValue(values.height_cm), weight_kg: numberValue(values.weight_kg),
      allow_storage: allowStorage, notice_version: HEALTH_PROFILE_NOTICE_VERSION, expected_updated_at: profile?.updated_at ?? null,
    });
    if (!validation.ok) { setFields(validation.fields); focusError(validation.fields); return; }
    lock.current = true; setOperation("save"); setFields({}); keepDraft("save");
    try {
      const result = await api<{ profile: HealthProfile }>("/api/profile", { method: "PUT", body: JSON.stringify(validation.value) });
      if (!mounted.current) return;
      if (!isHealthProfile(result.profile, userId)) throw new RequestError("저장 결과를 확인하지 못했어요. 저장된 정보를 확인해 주세요.", "UNKNOWN_OUTCOME", 503);
      saved(result.profile, "개인정보를 저장했어요.");
    } catch (cause) { if (mounted.current) fail(cause, "save"); }
    finally { lock.current = false; if (mounted.current) setOperation(null); }
  };
  const remove = async () => {
    if (lock.current || locked || !profile) return;
    lock.current = true; setOperation("delete"); setError(""); setNotice(""); keepDraft("delete");
    try {
      await api("/api/profile", { method: "DELETE", body: JSON.stringify({ expected_updated_at: profile.updated_at }) });
      if (mounted.current) saved(null, "개인정보를 삭제했어요.");
    } catch (cause) { if (mounted.current) fail(cause, "delete"); }
    finally { lock.current = false; if (mounted.current) { setOperation(null); setDeleteOpen(false); } }
  };
  const checkStored = async () => {
    if (lock.current || disabled || !outcome) return;
    lock.current = true; setOperation("check"); setError("");
    try {
      const result = await api<{ profile: HealthProfile | null }>("/api/profile");
      if (!mounted.current) return;
      if (result.profile !== null && !isHealthProfile(result.profile, userId)) throw new Error("저장된 개인정보를 확인하지 못했어요. 다시 확인해 주세요.");
      if (outcome === "delete" && result.profile === null) saved(null, "개인정보가 삭제된 것을 확인했어요.");
      else if (outcome === "save" && sameValues(values, result.profile)) saved(result.profile, "개인정보가 저장된 것을 확인했어요.");
      else {
        // 서버의 최신 버전을 확인하더라도 사용자의 작성 내용은 바꾸지 않아요.
        setProfile(result.profile); setOutcome(null); setShowStored(true);
        setNotice("현재 저장된 정보를 확인했어요. 입력한 내용과 비교한 뒤 다시 저장하거나 삭제해 주세요.");
      }
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (mounted.current) setOperation(null); }
  };
  const fieldDescription = (name: string) => fields[name] ? `profile-${name}-error` : undefined;

  return <section className="account-section" aria-labelledby="health-profile-title">
    <h2 id="health-profile-title" tabIndex={-1}>내 기본 정보</h2>
    <p className={styles.intro}>입력하고 싶은 항목만 적어 주세요. 나이는 만 나이로 적어요.</p>
    {loading ? <LoadingState label="개인정보를 불러오는 중이에요." /> : loadError ? <ErrorState message={loadError} retry={() => setRetry(value => value + 1)} /> : <form className={styles.form} onSubmit={save} noValidate aria-busy={pending}>
      {!canSave && <div className={styles.recovery}><p>현재 이용 안내에 동의해야 개인정보를 저장하거나 수정할 수 있어요. 기존 정보의 확인과 삭제는 가능해요.</p><Link href="/consent" onClick={event => { event.preventDefault(); onConsentOpen(); }}>이용 안내 보기</Link></div>}
      {notice && <p className="message" role="status">{notice}</p>}
      {error && <InlineError>{error}</InlineError>}
      {outcome && <div className={styles.recovery}>
        <p>{outcome === "conflict" ? "다른 화면에서 정보가 바뀌었어요. 현재 저장된 정보를 먼저 확인해 주세요. 입력한 내용은 유지돼요." : "저장·삭제 결과가 아직 확인되지 않았어요. 다시 처리하기 전에 저장된 정보를 확인해 주세요."}</p>
        <button className="button secondary" type="button" disabled={pending || disabled} onClick={() => void checkStored()}>{operation === "check" ? "확인 중" : "저장된 정보 확인"}</button>
      </div>}
      {showStored && <div className={styles.stored}>
        <h3>현재 저장된 정보</h3>
        {profile ? <dl>
          <div><dt>성별</dt><dd>{profile.sex === "female" ? "여성" : profile.sex === "male" ? "남성" : profile.sex === "other" ? "기타" : "미입력"}</dd></div>
          <div><dt>나이</dt><dd>{profile.age === null ? "미입력" : `${profile.age}세`}</dd></div>
          <div><dt>키</dt><dd>{profile.height_cm === null ? "미입력" : `${profile.height_cm}cm`}</dd></div>
          <div><dt>몸무게</dt><dd>{profile.weight_kg === null ? "미입력" : `${profile.weight_kg}kg`}</dd></div>
        </dl> : <p>저장된 개인정보가 없어요.</p>}
      </div>}
      {fields.profile && <InlineError>{fields.profile}</InlineError>}
      <fieldset className={styles.fields} disabled={locked || !canSave}>
        <legend className="sr-only">개인정보 선택 입력</legend>
        <div className="field">
          <label htmlFor="profile-sex">성별 (선택)</label>
          <select id="profile-sex" value={values.sex} aria-invalid={Boolean(fields.sex)} aria-describedby={fieldDescription("sex")} onChange={event => update("sex", event.target.value)}>
            <option value="">선택하지 않음</option><option value="female">여성</option><option value="male">남성</option><option value="other">기타</option>
          </select>
          {fields.sex && <p className="field-error" id="profile-sex-error">{fields.sex}</p>}
        </div>
        {([ ["age", "나이 (선택)", "세", "numeric"], ["height_cm", "키 (선택)", "cm", "decimal"], ["weight_kg", "몸무게 (선택)", "kg", "decimal"] ] as const).map(([name, label, unit, inputMode]) => <div className="field" key={name}>
          <label htmlFor={`profile-${name}`}>{label}</label>
          <div className={styles.numberField}>
            <input id={`profile-${name}`} type="text" inputMode={inputMode} autoComplete="off" maxLength={8} value={values[name]} aria-invalid={Boolean(fields[name])} aria-describedby={[`profile-${name}-unit`, fieldDescription(name)].filter(Boolean).join(" ")} onChange={event => update(name, event.target.value)} />
            <span id={`profile-${name}-unit`}>{unit}</span>
          </div>
          {fields[name] && <p className="field-error" id={`profile-${name}-error`}>{fields[name]}</p>}
        </div>)}
      </fieldset>
      <div className={styles.storageNotice} id="profile-storage-notice">
        <p>입력한 성별·나이·키·몸무게는 내 계정에서 확인하고 수정할 수 있도록 저장해요. 개인정보를 삭제하거나 회원 탈퇴할 때까지 보관해요.</p>
        <p>입력과 저장 동의는 선택이에요. 동의하지 않아도 다른 기능을 이용할 수 있어요. 지금은 도우미 답변에 사용하지 않아요.</p>
      </div>
      <div>
        <label className={styles.consent} htmlFor="profile-allow_storage">
          <input id="profile-allow_storage" type="checkbox" checked={allowStorage} disabled={locked || !canSave} aria-invalid={Boolean(fields.allow_storage)} aria-describedby={["profile-storage-notice", fieldDescription("allow_storage")].filter(Boolean).join(" ")} onChange={event => { setAllowStorage(event.target.checked); setFields(current => { const next = { ...current }; delete next.allow_storage; return next; }); setError(""); setNotice(""); }} />
          <span>입력한 개인정보를 저장하는 데 동의해요. (선택)</span>
        </label>
        {fields.allow_storage && <p className="field-error" id="profile-allow_storage-error">{fields.allow_storage}</p>}
      </div>
      <div className={styles.actions}>
        <button type="submit" className={`button ${styles.saveButton}`} disabled={locked || !canSave}>{operation === "save" ? "저장 중" : "개인정보 저장"}</button>
        {profile && <button type="button" className="text-button danger-text" disabled={locked} onClick={() => setDeleteOpen(true)}>개인정보 삭제</button>}
      </div>
    </form>}
    <ConfirmDialog open={deleteOpen} title="개인정보를 삭제할까요?" confirmLabel="개인정보 삭제" danger pending={pending} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()}>
      <p>저장한 성별·나이·키·몸무게와 해당 저장 동의 내역을 삭제해요. 계정과 혈당·식사 기록, 맞춤 조건은 남아요. 삭제한 개인정보는 복구할 수 없어요.</p>
    </ConfirmDialog>
  </section>;
}
