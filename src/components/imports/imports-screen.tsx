"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CSV_MAX_BYTES, contexts, parseCsv, seoulDay, validateCsvRows, type CsvMapping, type ImportBatch } from "@/lib/domain";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { clearDraft, readDraft, saveDraft } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { InlineError, PageHeading } from "@/components/ui/page-parts";
import styles from "@/components/insights/insights.module.css";
import local from "./imports.module.css";

type CsvSource = { csv: string; headers: string[]; rows: string[][] };
type ImportDraft = { source: CsvSource | null; mapping: CsvMapping; preview: boolean; confirmed: boolean };
const draftKey = "csv-import";
const templateCsv = "\uFEFF측정 시각,혈당,측정 상황,식사 시간대,식사 메모,혈당 단위\r\n";
const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv)}`;
const defaultMapping: CsvMapping = { glucose_mg_dl: -1, measured_at: -1, measurement_context: -1 };
const fields: { key: keyof CsvMapping; label: string; required: boolean; aliases: string[] }[] = [
  { key: "measured_at", label: "측정 시각", required: true, aliases: ["measured_at", "측정시각", "측정일시", "날짜시간"] },
  { key: "glucose_mg_dl", label: "혈당", required: true, aliases: ["glucose_mg_dl", "혈당", "혈당값"] },
  { key: "measurement_context", label: "측정 상황", required: true, aliases: ["measurement_context", "측정상황", "측정시점"] },
  { key: "meal_slot", label: "식사 시간대", required: false, aliases: ["meal_slot", "식사시간대"] },
  { key: "meal_memo", label: "식사 메모", required: false, aliases: ["meal_memo", "메모", "식사메모"] },
  { key: "unit", label: "혈당 단위", required: false, aliases: ["unit", "단위", "혈당단위"] },
];
function guessMapping(headers: string[]): CsvMapping {
  const next = { ...defaultMapping };
  for (const field of fields) { const index = headers.findIndex(header => field.aliases.includes(header.trim().replaceAll(" ", "").toLowerCase())); if (index >= 0) next[field.key] = index; }
  return next;
}
export function ImportsScreen() {
  const session = useAppSession();
  const [restored] = useState(() => readDraft(draftKey, session.user!.id));
  const values = restored?.values as ImportDraft | undefined;
  const [source, setSource] = useState<CsvSource | null>(values?.source || null);
  const [mapping, setMapping] = useState<CsvMapping>(values?.mapping || defaultMapping);
  const [preview, setPreview] = useState(values?.preview || false);
  const [confirmed, setConfirmed] = useState(values?.confirmed || false);
  const [requestId, setRequestId] = useState(restored?.recordId || crypto.randomUUID());
  const [unknown, setUnknown] = useState(Boolean(restored?.unknown));
  const [busy, setBusy] = useState<"read" | "save" | "check" | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ batch: ImportBatch; duplicate: boolean; date: string } | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (source && !result) saveDraft(draftKey, { userId: session.user!.id, values: { source, mapping, preview, confirmed }, recordId: requestId, unknown });
  }, [source, mapping, preview, confirmed, requestId, unknown, result, session.user]);
  const validation = source ? validateCsvRows(source.rows, mapping) : null;
  const pages = Math.max(1, Math.ceil((source?.rows.length || 0) / 20));
  const current = Math.min(page, pages);
  const selectFile = async (file?: File) => {
    if (!file || lock.current || unknown) return;
    lock.current = true; setBusy("read"); setError(""); setPreview(false); setSource(null); setConfirmed(false); clearDraft(draftKey);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("확장자가 .csv인 파일을 선택해 주세요.");
      if (file.size > CSV_MAX_BYTES) throw new Error("파일은 2MiB까지 가져올 수 있어요. 행을 나누어 다시 저장해 주세요.");
      const buffer = await file.arrayBuffer();
      let csv: string;
      try { csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw new Error("글자를 읽을 수 없어요. 파일을 UTF-8 CSV로 다시 저장해 주세요."); }
      const parsed = parseCsv(csv);
      if (!active.current) return;
      setSource({ csv, ...parsed }); setMapping(guessMapping(parsed.headers)); setRequestId(crypto.randomUUID()); setPage(1);
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const finish = (batch: ImportBatch, duplicate: boolean) => {
    const dates = validation?.records.map(record => seoulDay(record.measured_at)).sort() || [];
    clearDraft(draftKey); setResult({ batch, duplicate, date: dates.at(-1) || seoulDay() }); setSource(null); setUnknown(false); setError("");
    if (fileInput.current) fileInput.current.value = "";
    window.dispatchEvent(new Event("app-records-changed"));
  };
  const save = async () => {
    if (lock.current || !source || !validation || validation.errors.length || !confirmed || unknown || session.consent !== "current") return;
    lock.current = true; setBusy("save"); setError("");
    try { const saved = await api<{ batch: ImportBatch; duplicate: boolean }>("/api/imports", { method: "POST", body: JSON.stringify({ request_id: requestId, csv: source.csv, mapping }) }); if (active.current) finish(saved.batch, saved.duplicate); }
    catch (cause) { if (active.current) { setError(errorMessage(cause)); if (cause instanceof RequestError && cause.code === "UNKNOWN_OUTCOME") setUnknown(true); } }
    finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const recover = async () => {
    if (lock.current) return;
    lock.current = true; setBusy("check"); setError("");
    try { const saved = await api<{ batch: ImportBatch }>(`/api/imports?request_id=${encodeURIComponent(requestId)}`); if (active.current) finish(saved.batch, false); }
    catch (cause) { if (active.current) { if (cause instanceof RequestError && cause.status === 404) { setUnknown(false); setError("저장된 가져오기 결과가 없어요. 같은 내용으로 다시 저장할 수 있어요."); } else setError(errorMessage(cause)); } }
    finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const changeMapping = (key: keyof CsvMapping, value: string) => {
    const next = { ...mapping }; if (value === "" && !fields.find(field => field.key === key)!.required) delete next[key]; else next[key] = value === "" ? -1 : Number(value);
    setMapping(next); setError(""); setPage(1); setRequestId(crypto.randomUUID());
  };
  return <AppShell busy={Boolean(busy)}><PageHeading title="CSV 가져오기" description="표 파일의 혈당 기록을 확인한 뒤 한 번에 저장해요." action={<a className="button secondary" href={templateUrl} download="이어드림_혈당기록_양식.csv">CSV 템플릿 다운로드</a>} /><ConsentNotice />
    <ol className={local.steps} aria-label="가져오기 단계"><li aria-current={!preview && !result ? "step" : undefined}><span>1</span>파일과 열 선택</li><li aria-current={preview && !result ? "step" : undefined}><span>2</span>미리보기</li><li aria-current={result ? "step" : undefined}><span>3</span>저장 완료</li></ol>
    {error && <InlineError>{error}</InlineError>}
    {result ? <section className={`${styles.panel} ${local.complete}`}><h2>{result.duplicate ? "이미 가져온 내용이에요." : "혈당 기록을 가져왔어요."}</h2><p role="status">{result.duplicate ? "기존 가져오기 결과를 확인했어요. 같은 기록을 다시 추가하지 않았어요." : `${result.batch.row_count}건을 모두 저장했어요.`}</p><p>일지·캘린더·리포트에서 저장된 기록을 확인할 수 있어요.</p><div className={styles.actions}><Link className="button" href={`/records?date=${result.date}`}>가져온 기록 확인</Link><Link className="button secondary" href="/reports">리포트 보기</Link><button className="button secondary" onClick={() => { setResult(null); setPreview(false); setConfirmed(false); setRequestId(crypto.randomUUID()); }}>다른 파일 가져오기</button></div></section> : <>
      {!preview ? <section className={styles.panel}><h2>파일 선택</h2><label htmlFor="csv-file">UTF-8 CSV 파일 · 최대 2MiB · 데이터 1,000행 이하</label><input ref={fileInput} className={local.file} id="csv-file" type="file" accept=".csv,text/csv" disabled={Boolean(busy) || unknown || session.consent !== "current"} onChange={event => void selectFile(event.target.files?.[0])} /><p className={styles.muted}>첫 행은 열 이름이어야 해요. 파일 원본과 파일명은 저장하지 않아요.</p>{busy === "read" && <p role="status">파일을 읽는 중이에요.</p>}
        {source && <><h3>열 연결 · 데이터 {source.rows.length}행</h3><p className={styles.muted}>필수 항목 3개와 파일의 열을 각각 연결해 주세요. 같은 열을 중복 연결할 수 없어요.</p><div className={local.mapping}>{fields.map(field => <div className={styles.field} key={field.key}><label htmlFor={`map-${field.key}`}>{field.label}{field.required ? " (필수)" : " (선택)"}</label><select id={`map-${field.key}`} value={mapping[field.key] === undefined || mapping[field.key]! < 0 ? "" : mapping[field.key]} disabled={unknown || Boolean(busy)} onChange={event => changeMapping(field.key, event.target.value)}><option value="">{field.required ? "열 선택" : "연결하지 않음"}</option>{source.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header}</option>)}</select></div>)}</div><label className={local.confirm}><input type="checkbox" checked={confirmed} disabled={unknown || Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} /><span>혈당 단위가 mg/dL이고, 시간대 표시가 없는 측정 시각은 한국 시간임을 확인했어요.</span></label><button className="button" disabled={!confirmed || Boolean(busy) || [mapping.glucose_mg_dl, mapping.measured_at, mapping.measurement_context].some(value => value < 0)} onClick={() => { setPreview(true); setPage(1); }}>미리보기</button></>}
        <div className={local.help}><strong>파일 작성 방법</strong><ul><li>템플릿은 열 이름만 있는 빈 양식이에요. 두 번째 줄부터 기록을 작성하고 UTF-8 CSV로 저장해 주세요.</li><li>측정 시각 예: <code>2026-10-21 08:30</code> 또는 시간대가 포함된 <code>2026-10-20T23:30:00Z</code></li><li>측정 상황: {contexts.map(context => context.label).join(" · ")}</li><li>식사 시간대: 아침 · 점심 · 저녁 · 간식. 식전·식후·식후 2시간에만 넣고, 미지정은 빈칸으로 두세요.</li><li>혈당 단위는 <code>mg/dL</code>로 입력해 주세요. 혈당은 1~2,147,483,647의 정수, 메모는 500자까지예요. 이 숫자 범위는 저장 한도예요.</li></ul></div>
      </section> : source && validation && <section className={styles.panel}><div className={styles.panelHeader}><h2>가져올 기록 미리보기</h2><span className={styles.muted}>총 {source.rows.length}행 · 단위 mg/dL · 한국 시간</span></div><p className={styles.muted}>행 번호는 머리글을 제외한 데이터 순서예요. 오류가 하나라도 있으면 전체를 저장하지 않아요.</p>
        {validation.errors.length > 0 && <div className={local.errors} role="alert"><strong>확인이 필요한 오류 {validation.errors.length}개</strong><ul>{validation.errors.filter(item => item.row === 0 || (item.row > (current - 1) * 20 && item.row <= current * 20)).map((item, index) => <li key={index}>{item.row ? `${item.row}행: ` : ""}{item.message}</li>)}</ul><p>아래 페이지에서 모든 행의 오류를 확인할 수 있어요. 열 연결 또는 원본 파일을 고친 뒤 다시 확인해 주세요.</p></div>}
        <table className={local.preview}><caption className="sr-only">가져올 혈당 기록 원본과 행별 검증 결과</caption><thead><tr><th scope="col">행</th><th scope="col">측정 시각</th><th scope="col">혈당</th><th scope="col">측정 상황</th><th scope="col">메모·확인 결과</th></tr></thead><tbody>{source.rows.slice((current - 1) * 20, current * 20).map((row, index) => { const number = (current - 1) * 20 + index + 1; const rowError = validation.errors.find(item => item.row === number); return <tr key={number}><td>{number}</td><td>{row[mapping.measured_at] || "값 없음"}</td><td>{row[mapping.glucose_mg_dl] || "값 없음"} <small>{mapping.unit === undefined ? "mg/dL" : row[mapping.unit] || "단위 없음"}</small></td><td>{row[mapping.measurement_context] || "값 없음"}{mapping.meal_slot !== undefined && <small>{row[mapping.meal_slot] || "미지정"}</small>}</td><td>{mapping.meal_memo !== undefined && row[mapping.meal_memo]}<small className={rowError ? local.invalid : undefined}>{rowError?.message || (validation.errors.some(item => item.row === 0) ? "열 연결을 확인해 주세요." : "확인됨")}</small></td></tr>; })}</tbody></table>
        {pages > 1 && <nav className={styles.pagination} aria-label="CSV 미리보기 페이지"><button className="button secondary small" disabled={current === 1} onClick={() => setPage(current - 1)}>이전</button><span aria-live="polite">{current} / {pages} 페이지</span><button className="button secondary small" disabled={current === pages} onClick={() => setPage(current + 1)}>다음</button></nav>}
        {unknown && <p className={styles.note}>응답이 끊겨 저장 여부를 확인하지 못했어요. 같은 가져오기 요청의 결과를 먼저 확인해 주세요.</p>}
        <div className={`${styles.actions} ${styles.lower}`}><button className="button secondary" disabled={Boolean(busy) || unknown} onClick={() => setPreview(false)}>파일·열 연결 수정</button><button className="button" disabled={Boolean(busy) || unknown || validation.errors.length > 0 || !confirmed || session.consent !== "current"} onClick={() => void save()}>{busy === "save" ? "저장 중" : "전체 기록 저장"}</button>{unknown && <button className="button secondary" disabled={Boolean(busy)} onClick={() => void recover()}>{busy === "check" ? "저장 결과 확인 중" : "저장 결과 확인"}</button>}</div>
      </section>}
    </>}
  </AppShell>;
}
