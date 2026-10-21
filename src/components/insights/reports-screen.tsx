"use client";
import Link from "next/link";
import { useState } from "react";
import { contexts, summarizeGlucose } from "@/lib/domain";
import { AppShell } from "@/components/layout/app-shell";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { usePeriodData } from "./use-period-data";
import { PeriodChart } from "./period-chart";
import { RawRecords } from "./raw-records";
import styles from "./insights.module.css";
const format = (value: number | null) => value === null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export function ReportsScreen() {
  const [days, setDays] = useState<7 | 14>(7);
  const { data, error, load } = usePeriodData(`days=${days}`, false);
  const summary = data ? summarizeGlucose(data.records) : null;
  const groups = data ? contexts.map(context => ({ ...context, ...summarizeGlucose(data.records.filter(record => record.measurement_context === context.value)) })).filter(group => group.count) : [];
  const maxAverage = Math.max(1, ...groups.map(group => group.average || 0));
  return <AppShell><PageHeading title="내 혈당 리포트" description="직접 기록한 측정값을 기간별로 정리했어요." action={<div className={styles.field}><label htmlFor="report-period">조회 기간</label><select id="report-period" value={days} onChange={event => setDays(Number(event.target.value) as 7 | 14)}><option value={7}>최근 7일</option><option value={14}>최근 14일</option></select></div>} /><ConsentNotice />
    {error ? <ErrorState message={error} retry={() => void load()} /> : !data || !summary ? <LoadingState /> : <>
      <p className={styles.muted}>{data.range.label} · 한국 시간 · 혈당 단위 mg/dL</p>
      <dl className={styles.stats}>{[{ label: "평균 혈당", value: summary.average, note: `기록 ${summary.count}건` }, { label: "최솟값", value: summary.min, note: "기록된 가장 낮은 측정값" }, { label: "최댓값", value: summary.max, note: "기록된 가장 높은 측정값" }, { label: "기록 횟수", value: summary.count, note: `최근 ${days}일` }].map((item, index) => <div className={styles.stat} key={item.label}><dt>{item.label}</dt><dd>{format(item.value)} <span>{index === 3 ? "건" : "mg/dL"}</span></dd><dd className={styles.statNote}>{item.note}</dd></div>)}</dl>
      {summary.count === 0 ? <div className={styles.panel}><h2>선택한 기간에 혈당 기록이 없어요.</h2><p className={styles.muted}>측정한 기록이 있어야 평균과 최솟값·최댓값을 볼 수 있어요. 날짜를 바꾸거나 기록을 남겨 보세요.</p><Link className="button secondary" href="/records">기록 목록 보기</Link></div> : <>
        {summary.count === 1 && <p className={styles.note}>기록이 1건이어서 평균·최솟값·최댓값이 모두 같아요. 변화나 추세를 판단할 수 없어요.</p>}
        {summary.mixedContexts && <p className={styles.note}>공복·식후 등 서로 다른 측정 상황이 섞인 평균이에요. 아래에서 상황별 평균과 기록 건수를 함께 확인해 주세요.</p>}
        <div className={`${styles.columns} ${styles.lower}`}><section className={styles.panel}><h2>최근 {days}일 혈당 기록</h2><PeriodChart records={data.records} range={data.range} days={days} /><p className={styles.muted}>실제 측정값을 시간순으로 연결했어요. 선 사이의 값은 추가 측정값이나 예측값이 아니에요.</p></section><section className={styles.panel}><h2>측정 상황별 평균</h2><ul className={styles.contextList}>{groups.map(group => <li key={group.value}><span>{group.label}<small>{group.count}건</small></span><div className={styles.barTrack} aria-hidden="true"><div className={styles.bar} style={{ width: `${(group.average || 0) / maxAverage * 100}%` }} /></div><strong>{format(group.average)}<span className="sr-only"> mg/dL</span></strong></li>)}</ul><p className={styles.note}>기록된 값의 통계예요. 건강 상태나 치료 효과를 판정하지 않아요.</p><Link className={`button secondary ${styles.lower}`} href="/comparison">같은 조건으로 기간 비교</Link></section></div>
      </>}
      <section className={`${styles.panel} ${styles.lower}`}><RawRecords key={days} records={data.records} /></section>
    </>}
  </AppShell>;
}
