"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PREFERENCES_NOTICE_VERSION, type AgeBand, type PreferencesInput, type UserPreferences } from "@/lib/domain/service-types";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { useAppSession } from "@/components/auth/app-gate";
import { clearDraft, readDraft, saveDraft } from "@/lib/client/form-memory";
import { AppShell } from "@/components/layout/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState, InlineError, LoadingState, PageHeading } from "@/components/ui/page-parts";
import styles from "./information.module.css";

export const regions = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
export const ageLabels: Record<AgeBand, string> = { under_19: "19세 미만", "19_39": "19~39세", "40_64": "40~64세", "65_plus": "65세 이상" };
const empty = (): PreferencesInput => ({ region: null, age_band: null, diagnosed: null, insulin_use: null, matching_enabled: false, notice_version: PREFERENCES_NOTICE_VERSION });
const toInput = (value: UserPreferences | null): PreferencesInput => value ? ({ region: value.region, age_band: value.age_band, diagnosed: value.diagnosed, insulin_use: value.insulin_use, matching_enabled: value.matching_enabled, notice_version: PREFERENCES_NOTICE_VERSION }) : empty();
const boolValue = (value: boolean | null) => value === null ? "" : String(value);
const parseBool = (value: string) => value === "" ? null : value === "true";

export function PreferencesScreen() {
  const { user } = useAppSession(); const router = useRouter(); const userId = user!.id;
  const [values, setValues] = useState<PreferencesInput>(empty);
  const [baseline, setBaseline] = useState<PreferencesInput | null>(null);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const [unknown, setUnknown] = useState<"save" | "delete" | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null); const [version, setVersion] = useState(0);
  const lock = useRef(false); const mounted = useRef(true); const key = "matching-preferences";
  const dirty = baseline !== null && JSON.stringify(values) !== JSON.stringify(baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active) return; setLoading(true); setLoadError("");
      try { const { preferences } = await api<{ preferences: UserPreferences | null }>("/api/preferences"); if (!active) return; const fresh = toInput(preferences); const draft = readDraft(key, userId); setBaseline(fresh); setValues(draft ? draft.values as PreferencesInput : fresh); setUnknown(draft?.unknown as "save" | "delete" || null); }
      catch (cause) { if (active) setLoadError(errorMessage(cause)); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [userId, version]);
  useEffect(() => { if (!loading && (dirty || unknown)) saveDraft(key, { userId, values, recordId: "preferences", unknown }); else if (!loading) clearDraft(key); }, [loading, dirty, unknown, userId, values]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty || pending || unknown) event.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, pending, unknown]);
  const update = (next: Partial<PreferencesInput>) => { setValues(current => ({ ...current, ...next })); setNotice(""); setError(""); };
  const guard = (action: () => void) => { if (pending) return; if (dirty || unknown) setLeave(() => action); else action(); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (lock.current || unknown) return; lock.current = true; setPending(true); setError(""); setNotice("");
    saveDraft(key, { userId, values, recordId: "preferences", unknown: "save" });
    try { const result = await api<{ preferences: UserPreferences }>("/api/preferences", { method: "PUT", body: JSON.stringify(values) }); if (!mounted.current) return; const stored = toInput(result.preferences); setValues(stored); setBaseline(stored); clearDraft(key); setNotice(stored.matching_enabled ? "맞춤 조건을 저장했어요." : "맞춤 조건을 저장했어요. 개인 조건을 이용한 선별은 꺼져 있어요."); }
    catch (cause) { if (mounted.current) { setError(errorMessage(cause)); if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") setUnknown("save"); else saveDraft(key, { userId, values, recordId: "preferences" }); } }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  const remove = async () => {
    if (lock.current) return; lock.current = true; setPending(true); setError("");
    saveDraft(key, { userId, values, recordId: "preferences", unknown: "delete" });
    try { await api("/api/preferences", { method: "DELETE" }); if (!mounted.current) return; const fresh = empty(); setValues(fresh); setBaseline(fresh); setUnknown(null); clearDraft(key); setNotice("맞춤 조건을 삭제했어요. 개인 조건을 이용한 선별도 중지했어요."); setDeleteOpen(false); }
    catch (cause) { if (mounted.current) { setError(errorMessage(cause)); setDeleteOpen(false); if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") setUnknown("delete"); else saveDraft(key, { userId, values, recordId: "preferences" }); } }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  const checkResult = async () => {
    if (lock.current || !unknown) return; lock.current = true; setPending(true); setError("");
    try { const { preferences } = await api<{ preferences: UserPreferences | null }>("/api/preferences"); if (!mounted.current) return; const stored = toInput(preferences); const confirmed = unknown === "delete" ? preferences === null : JSON.stringify(stored) === JSON.stringify(values); if (confirmed) { setValues(stored); setBaseline(stored); setNotice(unknown === "delete" ? "맞춤 조건이 삭제된 것을 확인했어요." : "맞춤 조건이 저장된 것을 확인했어요."); } else { setBaseline(stored); setNotice("입력한 내용이 현재 저장값과 달라요. 내용을 확인한 뒤 다시 저장하거나 삭제할 수 있어요."); } setUnknown(null); clearDraft(key); }
    catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  return <AppShell guard={guard} busy={pending}><div className={styles.formWrap}>
    <PageHeading title="맞춤 정보 설정" description="관련 제도를 찾는 데 필요한 조건만 직접 선택해 주세요." action={<Link className="button secondary" href="/benefits" onClick={event => { event.preventDefault(); guard(() => router.push("/benefits")); }}>정책·혜택 보기</Link>} />
    {loading ? <LoadingState label="맞춤 설정을 불러오는 중이에요." /> : loadError ? <ErrorState message={loadError} retry={() => setVersion(value => value + 1)} /> : <section className={styles.panel}>
      <form className={styles.form} onSubmit={save} noValidate>
        {notice && <p className="message" role="status">{notice}</p>}{error && <InlineError>{error}</InlineError>}{unknown && <button type="button" className="button secondary" disabled={pending} onClick={() => void checkResult()}>저장·삭제 결과 확인</button>}
        <fieldset disabled={pending || Boolean(unknown)}><legend className="sr-only">선택 조건</legend><div className={styles.fields}>
          <div className={styles.field}><label htmlFor="region">거주 지역 (선택)</label><select id="region" value={values.region || ""} onChange={event => update({ region: event.target.value || null })}><option value="">선택하지 않음</option>{regions.map(region => <option key={region}>{region}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="age-band">연령대 (선택)</label><select id="age-band" value={values.age_band || ""} onChange={event => update({ age_band: event.target.value as AgeBand || null })}><option value="">선택하지 않음</option>{Object.entries(ageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="diagnosed">당뇨병 진단 여부 (선택)</label><select id="diagnosed" value={boolValue(values.diagnosed)} onChange={event => update({ diagnosed: parseBool(event.target.value) })}><option value="">선택하지 않음</option><option value="true">진단받았어요</option><option value="false">진단받지 않았어요</option></select></div>
          <div className={styles.field}><label htmlFor="insulin">인슐린 사용 여부 (선택)</label><select id="insulin" value={boolValue(values.insulin_use)} onChange={event => update({ insulin_use: parseBool(event.target.value) })}><option value="">선택하지 않음</option><option value="true">사용해요</option><option value="false">사용하지 않아요</option></select><p className={styles.muted}>당뇨병 관리기기 지원 요건을 확인할 때만 사용해요.</p></div>
        </div></fieldset>
        <div className={styles.note}><p>선택한 지역·연령대·진단·인슐린 사용 여부를 계정에 저장해요. 맞춤 선별을 켜면 공식 제도의 조건과 비교해요. 건강정보는 혈당으로 추정하지 않으며, 이 선택은 외부 AI 전송에 대한 동의가 아니에요.</p><p>맞춤 선별을 끄고 저장하면 조건 사용을 멈춰요. 아래 ‘맞춤 조건 삭제’로 저장한 값을 지울 수 있어요.</p></div>
        <label className={styles.consent}><input type="checkbox" checked={values.matching_enabled} disabled={pending || Boolean(unknown)} onChange={event => update({ matching_enabled: event.target.checked })} /><span>선택한 조건으로 맞춤 정보를 선별하는 데 동의해요.<small>선택 동의예요. 동의하지 않아도 공통 정책 정보를 볼 수 있어요.</small></span></label>
        <div className={styles.actions}><button className="button" type="submit" disabled={pending || Boolean(unknown)}>{pending ? "저장 중" : "맞춤 조건 저장"}</button><button className="button secondary" type="button" disabled={pending || Boolean(unknown)} onClick={() => setDeleteOpen(true)}>맞춤 조건 삭제</button></div>
      </form>
    </section>}
    <ConfirmDialog open={deleteOpen} title="맞춤 조건을 삭제할까요?" confirmLabel="맞춤 조건 삭제" danger pending={pending} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()}><p>저장한 지역·연령대·진단·인슐린 사용 여부를 지우고 맞춤 선별을 중지해요. 혈당과 식사 기록은 남아요.</p></ConfirmDialog>
    <ConfirmDialog open={Boolean(leave)} title="저장하지 않고 이동할까요?" confirmLabel="이동" onCancel={() => setLeave(null)} onConfirm={() => { const action = leave; setLeave(null); action?.(); }}><p>변경한 맞춤 조건이 아직 저장되지 않았어요.</p></ConfirmDialog>
  </div></AppShell>;
}
