"use client";
import Link from "next/link";
import { useState } from "react";
import { seoulDay } from "@/lib/domain";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { journalEntries, JournalTable } from "./journal-table";
import { usePeriodData } from "./use-period-data";
import styles from "./insights.module.css";

export function CalendarScreen() {
  const session = useAppSession();
  const [today] = useState(() => seoulDay());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const { data, error, load } = usePeriodData(`month=${month}`);
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const entries = data ? journalEntries(data.records, data.meals) : [];
  const selectedEntries = entries.filter(entry => seoulDay(entry.time) === selected);
  const counts = new Map<string, { glucose: number; meal: number }>();
  for (const entry of entries) { const day = seoulDay(entry.time); const count = counts.get(day) || { glucose: 0, meal: 0 }; count[entry.kind]++; counts.set(day, count); }
  const moveMonth = (amount: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1)).toISOString().slice(0, 7);
    setMonth(next); setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  };
  const selectedTitle = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${selected}T12:00:00+09:00`));
  return <AppShell>
    <PageHeading title="혈당 기록 캘린더" description="기록한 날짜를 확인하고, 선택한 날의 혈당과 식사를 살펴봐요." />
    <ConsentNotice />
    <div className={`${styles.columns} ${styles.calendarColumns}`}>
      <section className={styles.panel} aria-label="월별 기록 달력">
        <div className={styles.calendarHeader}><h2 aria-live="polite">{year}년 {monthNumber}월</h2><div className={styles.calendarControls}><button aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button><button onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>오늘</button><button aria-label="다음 달" onClick={() => moveMonth(1)}>›</button></div></div>
        {error ? <ErrorState message={error} retry={() => void load()} /> : !data ? <LoadingState label="이 달의 기록을 불러오는 중이에요." /> : <>
          <div className={styles.weekdays} aria-hidden="true">{["월", "화", "수", "목", "금", "토", "일"].map(day => <span key={day}>{day}</span>)}</div>
          <div className={styles.calendar} aria-label={`${year}년 ${monthNumber}월 날짜 선택`}>
            {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
            {Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, "0")}`; const count = counts.get(date); const total = (count?.glucose || 0) + (count?.meal || 0); return <button key={date} className={styles.day} aria-pressed={selected === date} aria-current={date === today ? "date" : undefined} aria-label={`${index + 1}${total ? ` ${total}건` : ""} · ${monthNumber}월 ${index + 1}일, 혈당 ${count?.glucose || 0}건, 식사 ${count?.meal || 0}건`} onClick={() => setSelected(date)}><span>{index + 1}</span>{" "}{total > 0 && <span className={styles.dayCount}>{total}건</span>}</button>; })}
          </div><p className={styles.legend}>● 기록 있음 · 숫자는 혈당과 식사의 전체 건수예요.</p><p className={styles.note}>날짜 표시는 기록 유무를 뜻해요. 혈당의 정상·이상 여부를 나타내지 않아요.</p>
        </>}
      </section>
      <section className={styles.panel} aria-labelledby="selected-day-heading"><p className={styles.muted}>선택한 날짜</p><div className={styles.panelHeader}><h2 id="selected-day-heading">{selectedTitle}</h2>{data && <span className={styles.muted}>혈당 {counts.get(selected)?.glucose || 0}건 · 식사 {counts.get(selected)?.meal || 0}건</span>}</div>
        {error ? <p className={styles.muted}>달력의 기록을 다시 불러온 뒤 확인해 주세요.</p> : !data ? <LoadingState /> : selectedEntries.length ? <JournalTable entries={selectedEntries} caption={`${selectedTitle} 전체 기록`} /> : <p className={styles.empty}>이 날짜에 기록이 없어요.</p>}
        <div className={`${styles.actions} ${styles.lower}`}><Link className="button secondary" href={`/records?date=${selected}`}>이 날짜 일지 보기</Link>{session.consent === "current" && <Link className="button" href="/records/new">혈당 기록하기</Link>}</div>
      </section>
    </div>
  </AppShell>;
}
