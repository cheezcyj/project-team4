"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { seoulInputToIso, validateRecord, seoulDay, isoToSeoulInput as seoulInput, type RecordInput, type GlucoseRecord } from "@/lib/domain";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { contexts, displayTime } from "@/lib/client/display";
import { clearDraft, readDraft, saveDraft, setFlashMessage } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState, InlineError, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { mealSlots } from "@/lib/domain/service-types";
import { useRecords } from "@/components/records/use-records";
type FormValues = {
  glucose_mg_dl: string;
  measured_at: string;
  measurement_context: string;
  meal_slot: string;
  meal_memo: string;
};
// 연결이 끊겼을 때 나중에 저장·삭제 결과를 조회하는 데 필요한 정보예요.
type UnknownAction = {
  kind: "save";
  id: string;
  submitted: RecordInput;
} | {
  kind: "delete";
  id: string;
};
function recordValues(record: GlucoseRecord): FormValues {
  return { glucose_mg_dl: String(record.glucose_mg_dl), measured_at: seoulInput(record.measured_at), measurement_context: record.measurement_context, meal_slot: record.meal_slot || "", meal_memo: record.meal_memo || "" };
}
function emptyValues(): FormValues { return { glucose_mg_dl: "", measured_at: seoulInput(), measurement_context: "", meal_slot: "", meal_memo: "" }; }
function matches(record: GlucoseRecord, submitted: RecordInput) {
  return record.glucose_mg_dl === submitted.glucose_mg_dl && new Date(record.measured_at).getTime() === new Date(submitted.measured_at).getTime() && record.measurement_context === submitted.measurement_context && (record.meal_slot || null) === (submitted.meal_slot || null) && (record.meal_memo || null) === submitted.meal_memo;
}
export function RecordFormScreen({ recordId }: {
  recordId?: string;
}) {
  const session = useAppSession();
  const recent = useRecords();
  const router = useRouter();
  const userId = session.user!.id;
  const key = recordId ? `edit:${recordId}` : "new";
  const canWrite = session.consent === "current";
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [baseline, setBaseline] = useState<FormValues | null>(null);
  const [record, setRecord] = useState<GlucoseRecord | null>(null);
  const [clientId, setClientId] = useState("");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [unknown, setUnknown] = useState<UnknownAction | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const dirty = ready && baseline !== null && JSON.stringify(values) !== JSON.stringify(baseline);
  const busy = pending || checking;
  const disabled = busy || Boolean(unknown) || conflict || !canWrite;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const init = async () => {
      setReady(false);
      setLoadError("");
      // 같은 계정의 초안만 복원해요. 동의가 없어도 진행 중이던 삭제 확인은 이어가요.
      const candidate = readDraft(key, userId);
      const draft = canWrite || (candidate?.unknown as UnknownAction | undefined)?.kind === "delete" ? candidate : undefined;
      setUnknown((draft?.unknown as UnknownAction | undefined) || null);
      setConflict(Boolean(draft?.conflict));
      if (draft?.unknown)
        setError("이전 저장·삭제 결과를 아직 확인하지 못했어요. 결과를 먼저 확인해 주세요.");
      if (recordId) {
        try {
          const result = await api<{
            record: GlucoseRecord;
          }>(`/api/records/${recordId}`);
          if (!active)
            return;
          const stored = recordValues(result.record);
          setRecord(result.record);
          setBaseline(stored);
          setValues(draft && canWrite ? draft.values as FormValues : stored);
          setClientId(recordId);
          setExpectedUpdatedAt(draft?.expectedUpdatedAt || result.record.updated_at);
          // 다른 탭에서 먼저 수정한 기록을 오래된 초안으로 덮어쓰지 않아요.
          if (draft?.expectedUpdatedAt && draft.expectedUpdatedAt !== result.record.updated_at && !draft.unknown) {
            setConflict(true);
            setError("작성 중 다른 곳에서 기록이 변경됐어요. 최신 기록을 불러와 확인해 주세요.");
          }
          if (draft && canWrite)
            setNotice("같은 계정에서 작성하던 내용을 불러왔어요. 저장 전 내용을 확인해 주세요.");
        }
        catch (cause) {
          if (active && cause instanceof RequestError && cause.status === 404 && draft?.unknown && draft.storedRecord) {
            setRecord(draft.storedRecord);
            setValues(draft.values as FormValues);
            setBaseline(recordValues(draft.storedRecord));
            setClientId(recordId);
          }
          else if (active)
            setLoadError(errorMessage(cause));
        }
      }
      else {
        const empty = emptyValues();
        setBaseline(empty);
        setValues(draft ? draft.values as FormValues : empty);
        setClientId(draft?.recordId || crypto.randomUUID());
        if (draft)
          setNotice("같은 계정에서 작성하던 내용을 불러왔어요. 저장 전 내용을 확인해 주세요.");
      }
      if (active)
        setReady(true);
    };
    queueMicrotask(() => {
      if (active)
        void init();
    });
    return () => { active = false; };
  }, [canWrite, key, recordId, reloadVersion, userId]);
  useEffect(() => {
    if (ready && clientId) {
      if (dirty || unknown || conflict)
        saveDraft(key, { userId, values, recordId: clientId, expectedUpdatedAt, unknown, conflict, storedRecord: record });
      else
        clearDraft(key);
    }
  }, [ready, clientId, dirty, key, userId, values, expectedUpdatedAt, unknown, conflict, record]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || unknown || busy) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, unknown, busy]);
  const guard = (action: () => void) => {
    if (busy)
      return;
    if (dirty || unknown)
      setLeaveAction(() => action);
    else
      action();
  };
  const update = (field: keyof FormValues, value: string) => {
    setValues(current => ({ ...current, [field]: value, ...(field === "measurement_context" && !["before_meal", "after_meal", "after_meal_2h"].includes(value) ? { meal_slot: "" } : {}) }));
    setFields(current => { const next = { ...current }; delete next[field]; return next; });
    setError("");
    setNotice("");
  };
  const focusError = (validation: Record<string, string>) => {
    const first = Object.keys(validation)[0];
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
  };
  const saved = (stored: GlucoseRecord) => { clearDraft(key); setFlashMessage(userId, "저장했어요."); setUnknown(null); setConflict(false); setBaseline(values); router.replace(`/records?date=${seoulDay(stored.measured_at)}`); router.refresh(); };
  const deleted = () => { clearDraft(key); setFlashMessage(userId, "기록을 삭제했어요."); setUnknown(null); setConflict(false); setBaseline(values); setDeleteOpen(false); router.replace(`/records?date=${seoulDay(record!.measured_at)}`); router.refresh(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || disabled || !clientId)
      return;
    const result = validateRecord({ ...values, meal_slot: values.meal_slot || null, measured_at: seoulInputToIso(values.measured_at) });
    if (!result.ok) {
      setFields(result.fields);
      focusError(result.fields);
      return;
    }
    lock.current = true;
    setPending(true);
    setError("");
    setNotice("");
    setFields({});
    // 새 기록의 번호와 요청 내용을 미리 기억해 두어 중복 저장을 피하고 결과를 확인해요.
    const receipt: UnknownAction = { kind: "save", id: clientId, submitted: result.value };
    saveDraft(key, { userId, values, recordId: clientId, expectedUpdatedAt, unknown: receipt, storedRecord: record });
    try {
      const response = await api<{
        record: GlucoseRecord;
      }>(recordId ? `/api/records/${recordId}` : "/api/records", { method: recordId ? "PATCH" : "POST", body: JSON.stringify({ ...result.value, ...(recordId ? { expected_updated_at: expectedUpdatedAt } : { id: clientId }) }) });
      if (!mounted.current)
        return;
      saved(response.record);
    }
    catch (cause) {
      if (!mounted.current)
        return;
      // 서버 저장 여부를 모를 때는 다시 저장하지 않고 조회로 결과를 확인하게 해요.
      if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") {
        setUnknown(receipt);
        setError("저장 결과를 확인하지 못했어요. 다시 저장하기 전에 결과를 확인해 주세요.");
      }
      else if (cause instanceof RequestError && cause.status === 409 && !recordId) {
        setUnknown(receipt);
        setError("같은 기록의 저장 요청이 있었어요. 저장 결과를 먼저 확인해 주세요.");
      }
      else if (cause instanceof RequestError && cause.status === 409) {
        setConflict(true);
        setError("다른 곳에서 기록이 변경됐어요. 최신 기록을 불러와 확인한 뒤 다시 수정해 주세요.");
      }
      else {
        saveDraft(key, { userId, values, recordId: clientId, expectedUpdatedAt, storedRecord: record });
        setError(errorMessage(cause));
        if (cause instanceof RequestError && cause.fields) {
          setFields(cause.fields);
          focusError(cause.fields);
        }
      }
    }
    finally {
      lock.current = false;
      setPending(false);
    }
  };
  const deleteRecord = async () => {
    if (lock.current || !record)
      return;
    lock.current = true;
    setPending(true);
    setError("");
    saveDraft(key, { userId, values, recordId: record.id, expectedUpdatedAt, unknown: { kind: "delete", id: record.id } satisfies UnknownAction, storedRecord: record });
    try {
      await api(`/api/records/${record.id}`, { method: "DELETE" });
      if (mounted.current)
        deleted();
    }
    catch (cause) {
      if (!mounted.current)
        return;
      setDeleteOpen(false);
      if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") {
        setUnknown({ kind: "delete", id: record.id });
        setError("삭제 결과를 확인하지 못했어요. 결과를 확인해 주세요.");
      }
      else {
        saveDraft(key, { userId, values, recordId: record.id, expectedUpdatedAt, storedRecord: record });
        setError(errorMessage(cause));
      }
    }
    finally {
      lock.current = false;
      setPending(false);
    }
  };
  // 응답을 못 받은 요청은 실제 기록과 비교해서 성공·미저장·다른 수정으로 구분해요.
  const checkOutcome = async () => {
    if (!unknown || lock.current)
      return;
    lock.current = true;
    setChecking(true);
    setError("");
    try {
      const { record: current } = await api<{
        record: GlucoseRecord;
      }>(`/api/records/${unknown.id}`);
      if (!mounted.current)
        return;
      if (unknown.kind === "delete") {
        setUnknown(null);
        setNotice("기록이 아직 남아 있어요. 삭제하려면 내용을 확인한 뒤 다시 삭제해 주세요.");
      }
      else if (matches(current, unknown.submitted)) {
        saved(current);
      }
      else {
        setUnknown(null);
        setConflict(true);
        setError("현재 저장된 기록이 입력한 내용과 달라요. 최신 기록을 확인한 뒤 다시 수정해 주세요.");
      }
    }
    catch (cause) {
      if (!mounted.current)
        return;
      if (cause instanceof RequestError && cause.status === 404) {
        if (unknown.kind === "delete")
          deleted();
        else {
          setUnknown(null);
          setNotice("해당 기록이 저장되어 있지 않아요. 입력한 내용을 확인한 뒤 저장할 수 있어요.");
        }
      }
      else
        setError("아직 결과를 확인할 수 없어요. 연결 상태를 확인한 뒤 다시 결과를 확인해 주세요.");
    }
    finally {
      lock.current = false;
      setChecking(false);
    }
  };
  const reloadStored = () => {
    clearDraft(key);
    setConflict(false);
    setUnknown(null);
    setError("");
    setNotice("");
    setReloadVersion(value => value + 1);
  };
  const fieldError = (name: string) => fields[name] ? <p id={`${name}-error`} className="field-error" role="alert">
    {fields[name]}
  </p> : null;
  return <AppShell guard={guard} busy={busy}>
      <Link
        href="/records"
        className="back-link"
        onClick={event => { event.preventDefault(); guard(() => router.push("/records")); }}>← 기록 목록</Link>
      <PageHeading
        title={recordId ? (canWrite ? "기록 상세·수정" : "기록 상세") : "혈당 기록하기"}
        description={recordId ? "저장한 내용을 확인하고 필요한 부분을 바꿀 수 있어요." : "측정한 값을 그대로 입력해 주세요."} />
      <ConsentNotice />
    <div className="record-layout">
    <div className="form-content">
      {!ready ? <LoadingState label={recordId ? "기록을 불러오는 중이에요." : "입력 화면을 준비하는 중이에요."} /> : loadError ? <ErrorState message={loadError} retry={() => setReloadVersion(value => value + 1)} /> : !recordId && !canWrite ? <div className="state-box">
        <h2>이용 안내를 먼저 확인해 주세요.</h2>
        <p>동의 후 새 기록을 저장할 수 있어요.</p>
        <Link className="button" href="/consent">이용 안내 보기</Link>
      </div> : <form
        ref={form}
        onSubmit={submit}
        noValidate
        className="record-form">
        {notice && <p className="message" role="status">
          {notice}
        </p>}
        {error && <InlineError>
          {error}
        </InlineError>}
        {unknown && <div className="outcome-check">
          <p>자동으로 다시 전송하지 않아요. 저장된 내용을 먼저 확인해 주세요.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void checkOutcome()}
            disabled={checking}>
            {checking ? "결과를 확인하는 중" : unknown.kind === "delete" ? "삭제 결과 확인" : "저장 결과 확인"}
          </button>
        </div>}
        {conflict && <div className="outcome-check">
          <p>아래 버튼을 누르면 작성 중인 내용을 최신 저장 내용으로 바꿔요.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setLeaveAction(() => reloadStored)}>최신 기록 불러오기</button>
        </div>}
        <fieldset disabled={disabled} className="form-fieldset">
          <legend className="sr-only">혈당 기록 입력</legend>
          <div className="form-row">
            <div className="field">
              <label htmlFor="glucose_mg_dl">혈당값 <span className="required-note">필수</span>
              </label>
              <div className={`unit-input ${values.glucose_mg_dl.length > 6 ? "long-glucose" : ""}`}>
                <input
                  id="glucose_mg_dl"
                  name="glucose_mg_dl"
                  type="text"
                  inputMode="numeric"
                  value={values.glucose_mg_dl}
                  onChange={event => update("glucose_mg_dl", event.target.value)}
                  aria-invalid={Boolean(fields.glucose_mg_dl)}
                  aria-describedby={fields.glucose_mg_dl ? "glucose_mg_dl-error" : "glucose-help"} />
                <span>mg/dL</span>
              </div>
              {fieldError("glucose_mg_dl")}
              <p id="glucose-help" className="field-hint">소수점 없이 숫자로 입력해 주세요.</p>
            </div>
            <div className="field">
              <label htmlFor="measured_at">측정 시각 <span className="required-note">필수</span>
              </label>
              <input
                id="measured_at"
                name="measured_at"
                type="datetime-local"
                value={values.measured_at}
                onChange={event => update("measured_at", event.target.value)}
                aria-invalid={Boolean(fields.measured_at)}
                aria-describedby={fields.measured_at ? "measured_at-error" : "time-help"} />
              {fieldError("measured_at")}
              <p id="time-help" className="field-hint">한국 시간으로 입력해 주세요.</p>
            </div>
          </div>
          <fieldset
            className="context-field"
            aria-describedby={fields.measurement_context ? "measurement_context-error" : undefined}
            aria-invalid={Boolean(fields.measurement_context)}>
            <legend>측정 상황 <span className="required-note">필수</span>
            </legend>
            <div className="context-options">
              {Object.entries(contexts).map(([value, label]) => <label
                key={value}
                className={`context-option ${values.measurement_context === value ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="measurement_context"
                  value={value}
                  checked={values.measurement_context === value}
                  onChange={() => update("measurement_context", value)} />
                <span>
                  {label}
                </span>
              </label>)}
            </div>
            {fieldError("measurement_context")}
          </fieldset>
          {["before_meal", "after_meal", "after_meal_2h"].includes(values.measurement_context) && <fieldset className="context-field" aria-describedby="meal-slot-help">
            <legend>식사 시간대 <span className="optional-note">선택</span></legend>
            <div className="context-options meal-slot-options">
              {[{value: "", label: "미지정"}, ...mealSlots].map(slot => <label key={slot.value} className={`context-option ${values.meal_slot === slot.value ? "selected" : ""}`}><input type="radio" name="meal_slot" value={slot.value} checked={values.meal_slot === slot.value} onChange={() => update("meal_slot", slot.value)} /><span>{slot.label}</span></label>)}
            </div>
            <p id="meal-slot-help" className="field-hint">측정 시각으로 식사 시간대를 자동 선택하지 않아요.</p>
            {fieldError("meal_slot")}
          </fieldset>}
          <div className="field memo-field">
            <label htmlFor="meal_memo">식사 메모 <span className="optional-note">선택</span>
            </label>
            <textarea
              id="meal_memo"
              className="memo-input resize-none"
              name="meal_memo"
              rows={4}
              value={values.meal_memo}
              onChange={event => update("meal_memo", event.target.value)}
              aria-invalid={Boolean(fields.meal_memo)}
              aria-describedby={fields.meal_memo ? "meal_memo-error memo-count" : "memo-count"} />
            {fieldError("meal_memo")}
            <p
              id="memo-count"
              className={`character-count ${[...values.meal_memo.trim()].length > 500 ? "over-limit" : ""}`}>
              {[...values.meal_memo.trim()].length} / 500자</p>
          </div>
        </fieldset>
        {record && <p className="record-updated">최근 저장 {displayTime(record.updated_at)}
        </p>}
        <div className="form-actions">
          <div>
            {record && <button
              type="button"
              className="delete-text-button"
              disabled={busy || Boolean(unknown)}
              onClick={() => setDeleteOpen(true)}>기록 삭제</button>}
          </div>
          <div className="form-primary-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => guard(() => router.push("/records"))}>
              {canWrite ? "취소" : "목록으로"}
            </button>
            {canWrite && <button className="button" type="submit" disabled={disabled}>
              {pending ? "저장 중" : recordId ? "수정 저장" : "기록 저장"}
            </button>}
          </div>
        </div>
      </form>}
    </div>
    <aside className="record-side-panel" aria-labelledby="record-side-heading">
      <h2 id="record-side-heading">최근 기록</h2>
      <p className="field-hint">최근 7일 중 마지막 세 번의 측정이에요.</p>
      {recent.error ? <p className="field-error">최근 기록을 불러오지 못했어요.</p> : !recent.data ? <p role="status">불러오는 중이에요.</p> : recent.data.records.length === 0 ? <p className="recent-empty">아직 기록이 없어요.</p> : <ul className="compact-records">{recent.data.records.slice(0, 3).map(item => <li key={item.id}><strong>{item.glucose_mg_dl.toLocaleString("ko-KR")} <small>mg/dL</small></strong><p>{contexts[item.measurement_context]}</p><time dateTime={item.measured_at}>{displayTime(item.measured_at)}</time></li>)}</ul>}
      <div className="record-side-note"><h3>측정한 그대로 기록해요.</h3><p>현재 시각을 기본으로 표시해요. 실제로 측정한 시각과 상황을 확인해 주세요.</p></div>
      <Link href="/meals/new" onClick={event => { event.preventDefault(); guard(() => router.push("/meals/new")); }}>식사만 따로 기록하기 →</Link>
    </aside>
    </div>
    <ConfirmDialog
      open={deleteOpen}
      title="이 기록을 삭제할까요?"
      confirmLabel="기록 삭제"
      danger
      pending={pending}
      onCancel={() => setDeleteOpen(false)}
      onConfirm={() => void deleteRecord()}>
      {record && <>
        <dl className="delete-summary">
          <div>
            <dt>측정 시각</dt>
            <dd>
              {displayTime(record.measured_at)}
            </dd>
          </div>
          <div>
            <dt>혈당</dt>
            <dd>
              {record.glucose_mg_dl.toLocaleString("ko-KR")} mg/dL · {contexts[record.measurement_context]}
            </dd>
          </div>
        </dl>
        <p>저장된 기록 한 건이 삭제돼요. 삭제한 기록은 되돌릴 수 없어요.</p>
      </>}
    </ConfirmDialog>
    <ConfirmDialog
      open={Boolean(leaveAction)}
      title={unknown ? "결과 확인을 마치지 않고 이동할까요?" : "작성한 내용을 지울까요?"}
      confirmLabel="내용 지우고 이동"
      onCancel={() => setLeaveAction(null)}
      onConfirm={() => { clearDraft(key); const action = leaveAction; setLeaveAction(null); action?.(); }}>
      <p>
        {unknown ? "저장이나 삭제 결과가 아직 확인되지 않았어요. 이동하면 이 화면의 작성 내용은 지워져요." : "저장하지 않은 내용은 지워져요. 계속 작성하려면 취소를 눌러 주세요."}
      </p>
    </ConfirmDialog>
  </AppShell>;
}
