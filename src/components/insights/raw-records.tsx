"use client";
import { useState } from "react";
import type { GlucoseRecord } from "@/lib/domain";
import { RecordTable } from "@/components/records/record-table";
import styles from "./insights.module.css";
export function RawRecords({ records, caption = "원본 혈당 기록" }: { records: GlucoseRecord[]; caption?: string }) {
  const [page, setPage] = useState(1);
  const sorted = [...records].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at) || b.id.localeCompare(a.id));
  const pages = Math.max(1, Math.ceil(sorted.length / 20));
  const current = Math.min(page, pages);
  return <><div className={styles.rawHeader}><h2>{caption}</h2><span className={styles.muted}>총 {records.length}건 · 한국 시간</span></div>
    {records.length ? <><RecordTable records={sorted.slice((current - 1) * 20, current * 20)} caption={caption} showMemo />{pages > 1 && <nav className={styles.pagination} aria-label={`${caption} 페이지`}><button className="button secondary small" disabled={current === 1} onClick={() => setPage(current - 1)}>이전</button><span aria-live="polite">{current} / {pages} 페이지</span><button className="button secondary small" disabled={current === pages} onClick={() => setPage(current + 1)}>다음</button></nav>}</> : <p className={styles.empty}>선택한 기간과 조건에 기록이 없어요.</p>}
  </>;
}
