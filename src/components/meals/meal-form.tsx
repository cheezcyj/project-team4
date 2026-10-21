"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isoToSeoulInput, seoulDay, seoulInputToIso } from "@/lib/domain";
import { mealTypes, type FoodCatalogItem, type MealInput, type MealRecord, type MealType, type NutritionSnapshot } from "@/lib/domain/service-types";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { clearDraft, readDraft, saveDraft, setFlashMessage } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState, InlineError, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { FoodPicker, NutritionValues } from "./food-picker";
import styles from "./meals.module.css";

type DraftItem = { id: string; food_id: string | null; free_text: string | null; amount: string; unit: string; snapshot: NutritionSnapshot | null };
type Values = { meal_at: string; meal_type: MealType; memo: string; items: DraftItem[] };
type Receipt = { kind: "save"; id: string; submitted: MealInput } | { kind: "delete"; id: string };
const emptyValues = (): Values => ({ meal_at: isoToSeoulInput(), meal_type: "other", memo: "", items: [] });
const storedValues = (meal: MealRecord): Values => ({ meal_at: isoToSeoulInput(meal.meal_at), meal_type: meal.meal_type, memo: meal.memo || "", items: meal.items.map(item => ({ id: item.id, food_id: item.food_id, free_text: item.free_text, amount: item.amount_value === null ? "" : String(item.amount_value), unit: item.amount_unit || "", snapshot: item.nutrition_snapshot })) });
const sameSaved = (meal: MealRecord, submitted: MealInput) => new Date(meal.meal_at).getTime() === new Date(submitted.meal_at).getTime() && meal.meal_type === submitted.meal_type && (meal.memo || null) === submitted.memo && meal.items.length === submitted.items.length && submitted.items.every(item => meal.items.some(stored => stored.id === item.id && stored.food_id === (item.food_id || null) && stored.free_text === (item.free_text || null) && stored.amount_value === (item.amount_value ?? null) && stored.amount_unit === (item.amount_unit || null)));

export function MealFormScreen({ mealId }: { mealId?: string }) {
  const session = useAppSession();
  const router = useRouter();
  const userId = session.user!.id;
  const canWrite = session.consent === "current";
  const key = mealId ? `meal:edit:${mealId}` : "meal:new";
  const [values, setValues] = useState<Values>(emptyValues);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [id, setId] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<Receipt | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const dirty = ready && baseline !== null && JSON.stringify(values) !== JSON.stringify(baseline);
  const disabled = pending || Boolean(unknown) || conflict || !canWrite;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      setReady(false); setLoadError("");
      const draft = readDraft(key, userId);
      try {
        const meal = mealId ? (await api<{ meal: MealRecord }>(`/api/meals/${mealId}`)).meal : null;
        if (!active) return;
        const fresh = meal ? storedValues(meal) : emptyValues();
        setValues(draft && canWrite ? draft.values as Values : fresh); setBaseline(fresh);
        setId(mealId || draft?.recordId || crypto.randomUUID()); setUpdatedAt(draft?.expectedUpdatedAt || meal?.updated_at);
        setUnknown(draft?.unknown as Receipt || null);
        setConflict(Boolean(draft?.conflict || (draft?.expectedUpdatedAt && meal && draft.expectedUpdatedAt !== meal.updated_at && !draft.unknown)));
        if (draft && canWrite) setNotice("같은 계정에서 작성하던 식사를 불러왔어요.");
      } catch (cause) {
        if (active && cause instanceof RequestError && cause.status === 404 && (draft?.unknown as Receipt)?.kind === "delete") {
          clearDraft(key); setFlashMessage(userId, "식사 기록을 삭제했어요."); router.replace("/records"); return;
        }
        if (active) setLoadError(errorMessage(cause));
      } finally { if (active) setReady(true); }
    };
    queueMicrotask(() => { if (active) void initialize(); });
    return () => { active = false; };
  }, [key, mealId, userId, canWrite, reload, router]);
  useEffect(() => {
    if (!ready || !id) return;
    if (dirty || unknown || conflict) saveDraft(key, { userId, values, recordId: id, expectedUpdatedAt: updatedAt, unknown, conflict });
    else clearDraft(key);
  }, [ready, id, dirty, unknown, conflict, values, key, userId, updatedAt]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || unknown || pending) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, unknown, pending]);
  const guard = (action: () => void) => { if (pending) return; if (dirty || unknown) setLeave(() => action); else action(); };
  const edit = (next: Partial<Values>) => { setValues(current => ({ ...current, ...next })); setError(""); setFields({}); setNotice(""); };
  const addFood = (food: FoodCatalogItem) => {
    const snapshot: NutritionSnapshot = { schema_version: 1, food_name: food.food_name, source_code: food.source_code, source: food.source, source_version: food.source_version, source_sha256: food.source_sha256, basis_value: food.basis_value, basis_unit: food.basis_unit, nutrients: { kcal: food.kcal, carbs_g: food.carbs_g, sugars_g: food.sugars_g, protein_g: food.protein_g, fat_g: food.fat_g, fiber_g: food.fiber_g, sodium_mg: food.sodium_mg }, unit_validated: food.unit_validated, captured_at: "" };
    edit({ items: [...values.items, { id: crypto.randomUUID(), food_id: food.id, free_text: null, amount: "", unit: "", snapshot }] });
    setNotice(`${food.food_name}을 이번 식사에 추가했어요.`);
  };
  const complete = (meal?: MealRecord) => {
    clearDraft(key); setUnknown(null); setBaseline(values); setFlashMessage(userId, meal ? "식사를 저장했어요." : "식사 기록을 삭제했어요.");
    router.replace(`/records?date=${meal ? seoulDay(meal.meal_at) : values.meal_at.slice(0, 10)}`); router.refresh();
  };
  const validate = (): MealInput | null => {
    const next: Record<string, string> = {};
    const instant = seoulInputToIso(values.meal_at);
    if (!instant) next.meal_at = "실제 식사 날짜와 시각을 입력해 주세요.";
    if (!values.items.length && !values.memo.trim()) next.items = "음식을 추가하거나 식사 메모를 입력해 주세요.";
    if ([...values.memo.trim()].length > 500) next.memo = "메모는 500자까지 입력해 주세요.";
    values.items.forEach((item, index) => {
      if (Boolean(item.amount.trim()) !== Boolean(item.unit)) next[`item-${index}`] = "섭취량과 단위를 함께 입력하거나 둘 다 비워 주세요.";
      else if (item.amount && (!/^\d+(\.\d{1,4})?$/.test(item.amount) || Number(item.amount) <= 0 || Number(item.amount) >= 100000000)) next[`item-${index}`] = "섭취량은 0보다 크고 1억 미만인 숫자, 소수점 4자리까지 입력해 주세요.";
    });
    setFields(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => {
        const first = Object.keys(next)[0];
        const target = first === "memo" || first === "items" ? "meal_memo" : first.startsWith("item-") ? `amount-${values.items[Number(first.slice(5))]?.id}` : first;
        document.getElementById(target)?.focus();
      });
      return null;
    }
    return { meal_at: instant!, meal_type: values.meal_type, memo: values.memo.trim() || null, items: values.items.map(item => ({ id: item.id, food_id: item.food_id, free_text: item.free_text, amount_value: item.amount ? Number(item.amount) : null, amount_unit: item.unit || null })) };
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (lock.current || disabled || !id) return;
    const input = validate(); if (!input) return;
    lock.current = true; setPending(true); setError(""); setNotice("");
    const receipt: Receipt = { kind: "save", id, submitted: input };
    saveDraft(key, { userId, values, recordId: id, expectedUpdatedAt: updatedAt, unknown: receipt });
    try { const response = await api<{ meal: MealRecord }>(mealId ? `/api/meals/${mealId}` : "/api/meals", { method: mealId ? "PATCH" : "POST", body: JSON.stringify({ ...input, id, expected_updated_at: updatedAt }) }); if (mounted.current) complete(response.meal); }
    catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof RequestError && (cause.code === "UNKNOWN_OUTCOME" || (cause.status === 409 && !mealId))) { setUnknown(receipt); setError("저장 결과를 확인하지 못했어요. 다시 저장하기 전에 결과를 확인해 주세요."); }
      else if (cause instanceof RequestError && cause.status === 409) { setConflict(true); setError("다른 곳에서 식사가 변경됐어요. 최신 기록을 확인한 뒤 수정해 주세요."); }
      else { setError(errorMessage(cause)); if (cause instanceof RequestError && cause.fields) setFields(cause.fields); saveDraft(key, { userId, values, recordId: id, expectedUpdatedAt: updatedAt }); }
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  const remove = async () => {
    if (lock.current || !mealId) return;
    lock.current = true; setPending(true); setError(""); const receipt: Receipt = { kind: "delete", id: mealId };
    saveDraft(key, { userId, values, recordId: id, expectedUpdatedAt: updatedAt, unknown: receipt });
    try { await api(`/api/meals/${mealId}`, { method: "DELETE" }); if (mounted.current) complete(); }
    catch (cause) { if (mounted.current) { setError(errorMessage(cause)); setDeleteOpen(false); if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") setUnknown(receipt); else saveDraft(key, { userId, values, recordId: id, expectedUpdatedAt: updatedAt }); } }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  const checkResult = async () => {
    if (lock.current || !unknown) return; lock.current = true; setPending(true); setError("");
    try {
      const { meal } = await api<{ meal: MealRecord }>(`/api/meals/${unknown.id}`);
      if (!mounted.current) return;
      if (unknown.kind === "save" && sameSaved(meal, unknown.submitted)) complete(meal);
      else if (unknown.kind === "delete") { setUnknown(null); setNotice("식사가 아직 남아 있어요. 삭제하려면 다시 선택해 주세요."); }
      else { setUnknown(null); setConflict(true); setError("현재 기록과 입력한 내용이 달라요. 최신 기록을 확인해 주세요."); }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof RequestError && cause.status === 404) { if (unknown.kind === "delete") complete(); else { setUnknown(null); setNotice("식사가 저장되어 있지 않아요. 내용을 확인한 뒤 저장할 수 있어요."); } }
      else setError(errorMessage(cause));
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  const refresh = () => { clearDraft(key); setConflict(false); setUnknown(null); setError(""); setNotice(""); setReload(value => value + 1); };
  const fieldError = (name: string) => fields[name] ? <p id={`${name}-error`} className="field-error" role="alert">{fields[name]}</p> : null;
  return <AppShell guard={guard} busy={pending}>
    <PageHeading title={mealId ? "식사 상세·수정" : "음식 검색·식사 기록"} description="음식을 골라 이번 식사에 추가해 주세요. 식사만 따로 기록할 수도 있어요." action={<Link className="button secondary" href="/records" onClick={event => { event.preventDefault(); guard(() => router.push("/records")); }}>통합 일지</Link>} />
    <ConsentNotice />
    {!ready ? <LoadingState label="식사를 불러오는 중이에요." /> : loadError ? <ErrorState message={loadError} retry={() => setReload(value => value + 1)} /> : <>
      <div className={styles.feedback}>{notice && <p className="message" role="status">{notice}</p>}{error && <InlineError>{error}</InlineError>}{unknown && <button className="button secondary" disabled={pending} onClick={() => void checkResult()}>저장·삭제 결과 확인</button>}{conflict && <div className={styles.note}><p>최신 기록을 불러오면 작성 중인 내용이 바뀌어요.</p><button className="button secondary" onClick={() => setLeave(() => refresh)}>최신 식사 불러오기</button></div>}</div>
      <div className={styles.layout}>
        <FoodPicker selectedIds={values.items.flatMap(item => item.food_id ? [item.food_id] : [])} disabled={disabled} onSelect={addFood} onDirect={name => { edit({ items: [...values.items, { id: crypto.randomUUID(), food_id: null, free_text: name, amount: "", unit: "", snapshot: null }] }); setNotice(`${name}을 이번 식사에 추가했어요.`); }} />
        <section className={styles.panel} aria-labelledby="meal-heading"><h2 id="meal-heading">이번 식사 <span className={styles.hint}>{values.items.length}개 선택</span></h2>
          {values.items.length === 0 && <p className={styles.empty}>선택한 음식이 없어요. 음식 없이 메모만 남겨도 괜찮아요.</p>}
          <ul className={styles.selection}>{values.items.map((item, index) => {
            const snapshot = item.snapshot; const name = snapshot?.food_name || item.free_text;
            const ratio = snapshot?.unit_validated && Number(item.amount) > 0 && item.unit === snapshot.basis_unit ? Number(item.amount) / snapshot.basis_value : null;
            return <li key={item.id} className={styles.item}><div className={styles.itemHead}><strong>{name}</strong><button type="button" className="text-button" aria-label={`${name} 식사에서 빼기`} disabled={disabled} onClick={() => edit({ items: values.items.filter(current => current.id !== item.id) })}>빼기</button></div>
              <div className={styles.amount}><label htmlFor={`amount-${item.id}`}>섭취량 (선택)<input id={`amount-${item.id}`} type="text" inputMode="decimal" value={item.amount} disabled={disabled} aria-invalid={Boolean(fields[`item-${index}`])} aria-describedby={fields[`item-${index}`] ? `item-${index}-error` : undefined} onChange={event => edit({ items: values.items.map(current => current.id === item.id ? { ...current, amount: event.target.value } : current) })} /></label><label htmlFor={`unit-${item.id}`}>단위<select id={`unit-${item.id}`} value={item.unit} disabled={disabled} onChange={event => edit({ items: values.items.map(current => current.id === item.id ? { ...current, unit: event.target.value } : current) })}><option value="">미입력</option><option value="g">g</option><option value="ml">ml</option></select></label></div>
              {fieldError(`item-${index}`)}
              {snapshot ? <details><summary>{ratio === null ? `${snapshot.basis_value}${snapshot.basis_unit} 기준 영양정보` : `입력한 ${item.amount}${item.unit} 영양정보`}</summary><NutritionValues nutrients={snapshot.nutrients} ratio={ratio ?? 1} /><p className={styles.source}>{snapshot.source} · {snapshot.source_version}</p></details> : <p className={styles.hint}>영양정보 없음</p>}
              {item.amount && item.unit && ratio === null && snapshot && <p className={styles.hint}>{!snapshot.unit_validated ? "원본 기준 단위 검증 전이라 섭취량을 환산하지 않았어요." : "기준 단위와 달라 섭취량을 환산하지 않았어요. g과 ml는 자동 변환하지 않아요."}</p>}
            </li>;
          })}</ul>
          <form className={styles.form} onSubmit={submit} noValidate>
            {fieldError("items")}<fieldset disabled={disabled}><legend className="sr-only">식사 정보</legend>
              <label htmlFor="meal_at">식사 시각<input id="meal_at" name="meal_at" type="datetime-local" value={values.meal_at} onChange={event => edit({ meal_at: event.target.value })} aria-invalid={Boolean(fields.meal_at)} aria-describedby={fields.meal_at ? "meal_at-error" : undefined} /></label>{fieldError("meal_at")}
              <div><p>식사 종류</p><div className={styles.typeOptions}>{mealTypes.map(type => <label key={type.value}><input type="radio" name="meal_type" value={type.value} checked={values.meal_type === type.value} onChange={() => edit({ meal_type: type.value })} />{type.label}</label>)}</div></div>
              <label htmlFor="meal_memo">식사 메모 (선택)<textarea id="meal_memo" name="memo" className="resize-none" value={values.memo} onChange={event => edit({ memo: event.target.value })} aria-invalid={Boolean(fields.memo)} aria-describedby={fields.memo ? "memo-error meal-memo-count" : "meal-memo-count"} /></label>{fieldError("memo")}<p id="meal-memo-count" className="character-count">{[...values.memo.trim()].length} / 500자</p>
              <button type="submit" className="button full-width">{pending ? "저장 중" : mealId ? "식사 수정 저장" : "식사 기록 저장"}</button>
            </fieldset>
            {!canWrite && <p className={styles.note}>저장·수정은 이용 안내 동의 후 가능해요. 저장한 식사 조회와 삭제는 할 수 있어요.</p>}
            {mealId && <button type="button" className="button secondary" disabled={pending || Boolean(unknown)} onClick={() => setDeleteOpen(true)}>식사 삭제</button>}
          </form>
        </section>
      </div><p className={styles.footer}>식사 시각은 한국 시간이에요. 영양값은 각 자료의 원본 기준이며 실제 제품이나 조리법에 따라 다를 수 있어요.</p>
    </>}
    <ConfirmDialog open={deleteOpen} title="이 식사를 삭제할까요?" confirmLabel="식사 삭제" danger pending={pending} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()}><p>{values.meal_at.replace("T", " ")} · {mealTypes.find(type => type.value === values.meal_type)?.label} 식사와 연결된 음식 항목을 영구 삭제해요.</p><p>삭제한 식사는 복구할 수 없어요.</p></ConfirmDialog>
    <ConfirmDialog open={Boolean(leave)} title="저장하지 않고 이동할까요?" confirmLabel="이동" onCancel={() => setLeave(null)} onConfirm={() => { const action = leave; setLeave(null); action?.(); }}><p>아직 저장하지 않은 내용이 있어요. 입력한 내용을 확인한 뒤 이동해 주세요.</p></ConfirmDialog>
  </AppShell>;
}
