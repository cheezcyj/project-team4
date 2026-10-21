"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { isCalendarDay, seoulDay } from "@/lib/domain";
import { clearFlashMessage, readFlashMessage } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { usePeriodData } from "@/components/insights/use-period-data";
import { journalEntries, JournalTable } from "@/components/insights/journal-table";
import styles from "@/components/insights/insights.module.css";

export function RecordsScreen() {
  const session = useAppSession();
  const router = useRouter();
  const params = useSearchParams();
  const queryDate = params.get("date") || "";
  const [inputDate, setInputDate] = useState(queryDate || seoulDay());
  const [dateError, setDateError] = useState("");
  const [kind, setKind] = useState<"all" | "glucose" | "meal">("all");
  const [page, setPage] = useState(1);
  const [success] = useState(() => readFlashMessage(session.user!.id));
  useEffect(() => { clearFlashMessage(session.user!.id); }, [session.user]);
  const { data, error, load } = usePeriodData(queryDate ? `date=${encodeURIComponent(queryDate)}` : "");
  const entries = data ? journalEntries(data.records, data.meals).filter(entry => kind === "all" || kind === entry.kind) : [];
  const pages = Math.max(1, Math.ceil(entries.length / 20));
  const current = Math.min(page, pages);
  const showDate = (event: FormEvent) => {
    event.preventDefault();
    if (!isCalendarDay(inputDate)) { setDateError("확인할 날짜를 선택해 주세요."); return; }
    setDateError(""); setPage(1); router.push(`/records?date=${inputDate}`);
  };
  return <AppShell>
    <PageHeading title="기록 목록" description="혈당과 식사 기록을 날짜·시간순으로 함께 확인해요." action={session.consent === "current" && <div className={styles.actions}><Link className="button secondary" href="/meals/new">식사 기록하기</Link><Link className="button" href="/records/new">＋ 혈당 기록하기</Link></div>} />
    <ConsentNotice />
    {success && <p className="message success-message" role="status">{success}</p>}
    <div className={styles.toolbar}>
      <button className={`button ${!queryDate ? "" : "secondary"}`} aria-pressed={!queryDate} onClick={() => { setPage(1); setDateError(""); router.push("/records"); }}>최근 7일</button>
      <form onSubmit={showDate} noValidate><div className={styles.field}><label htmlFor="record-date">특정 날짜</label><input id="record-date" type="date" value={inputDate} aria-describedby={dateError ? "date-error" : undefined} aria-invalid={Boolean(dateError)} onChange={event => setInputDate(event.target.value)} /></div><button className="button secondary" type="submit">날짜 조회</button></form>
      <div className={styles.tabs} aria-label="기록 종류">{([{value:"all",label:"전체"},{value:"glucose",label:"혈당"},{value:"meal",label:"식사"}] as const).map(item => <button key={item.value} aria-pressed={kind === item.value} onClick={() => { setKind(item.value); setPage(1); }}>{item.label}</button>)}</div>
    </div>
    {dateError && <p id="date-error" className="field-error" role="alert">{dateError}</p>}
    {error ? <ErrorState message={error} retry={() => void load()} /> : !data ? <LoadingState /> : <div className={styles.columns}>
      <section className={styles.panel} aria-label="통합 일지"><div className={styles.panelHeader}><h2>{queryDate ? `${queryDate.replaceAll("-", ". ")} 기록` : "최근 7일 기록"}</h2><span className={styles.muted}>총 {entries.length}건</span></div>
        <p className={styles.muted}>{data.range.label} · 최신 시각순</p>
        {entries.length ? <><JournalTable entries={entries.slice((current - 1) * 20, current * 20)} /><nav className={styles.pagination} aria-label="기록 목록 페이지"><button className="button secondary small" disabled={current <= 1} onClick={() => setPage(current - 1)}>이전</button><span aria-live="polite">{current} / {pages} 페이지</span><button className="button secondary small" disabled={current >= pages} onClick={() => setPage(current + 1)}>다음</button></nav></> : <div className={styles.empty}><h3>선택한 기간에 기록이 없어요.</h3><p>다른 날짜나 기록 종류를 선택해 보세요.</p>{session.consent === "current" && <Link className="button secondary" href="/records/new">혈당 기록하기</Link>}</div>}
      </section>
      <aside className={styles.panel}><h2>선택한 기간 한눈에</h2><dl className={styles.summary}><div><dt>혈당 기록</dt><dd>{data.records.length} <span>건</span></dd></div><div><dt>식사 기록</dt><dd>{data.meals.length} <span>건</span></dd></div></dl><p className={styles.note}>혈당과 식사를 함께 볼 수 있어요. 음식이 혈당 변화의 원인이라고 판단하지는 않아요.</p><div className={`${styles.actions} ${styles.lower}`}><Link className="button secondary" href="/calendar">달력으로 보기</Link>{session.consent === "current" && <Link className="button secondary" href="/imports">CSV 가져오기</Link>}</div></aside>
    </div>}
  </AppShell>;
}
