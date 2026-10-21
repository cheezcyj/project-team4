"use client";
import { useState } from "react";
import { comparePeriods, contexts, daysRange, mealSlots, previousRange, recordInRange, seoulDay, type MealSlot, type MeasurementContext } from "@/lib/domain";
import { AppShell } from "@/components/layout/app-shell";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { usePeriodData } from "./use-period-data";
import { RawRecords } from "./raw-records";
import styles from "./insights.module.css";
const format = (value: number | null) => value === null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export function ComparisonScreen() {
  const [days, setDays] = useState<7 | 14>(7);
  const [context, setContext] = useState<MeasurementContext>("fasting");
  const [mealSlot, setMealSlot] = useState<MealSlot | null>(null);
  const [today] = useState(() => seoulDay());
  const current = daysRange(days, `${today}T12:00:00+09:00`), previous = previousRange(current);
  const { data, error, load } = usePeriodData(`start=${seoulDay(previous.start)}&end=${today}`, false);
  const comparison = data ? comparePeriods(data.records, { current, previous }, { measurement_context: context, meal_slot: mealSlot }) : null;
  const differenceMagnitude = Math.abs(comparison?.difference || 0);
  const differenceLabel = differenceMagnitude > 0 && differenceMagnitude < 0.1 ? "0.1 mg/dL 미만" : `${format(differenceMagnitude)} mg/dL`;
  const mealRelated = ["before_meal", "after_meal", "after_meal_2h"].includes(context);
  const condition = `${contexts.find(item => item.value === context)?.label}${mealRelated ? ` · ${mealSlots.find(slot => slot.value === mealSlot)?.label || "미지정"}` : ""}`;
  const matching = data?.records.filter(record => record.measurement_context === context && (record.meal_slot || null) === mealSlot) || [];
  return <AppShell><PageHeading title="측정 조건·기간 비교" description="같은 측정 상황과 식사 시간대의 기록을 바로 앞 기간과 비교해요." /><ConsentNotice />
    <div className={styles.toolbar}><div className={styles.field}><label htmlFor="comparison-period">비교 기간</label><select id="comparison-period" value={days} onChange={event => setDays(Number(event.target.value) as 7 | 14)}><option value={7}>7일씩 비교</option><option value={14}>14일씩 비교</option></select></div><div className={styles.field}><label htmlFor="comparison-context">측정 상황</label><select id="comparison-context" value={context} onChange={event => { setContext(event.target.value as MeasurementContext); setMealSlot(null); }}>{contexts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>{mealRelated && <div className={styles.field}><label htmlFor="comparison-slot">식사 시간대</label><select id="comparison-slot" value={mealSlot || ""} onChange={event => setMealSlot((event.target.value || null) as MealSlot | null)}><option value="">미지정</option>{mealSlots.map(slot => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select></div>}</div>
    {error ? <ErrorState message={error} retry={() => void load()} /> : !data || !comparison ? <LoadingState /> : <>
      <div className={styles.columns}><section className={styles.panel}><h2>{condition} · 기간 평균</h2><div className={styles.comparison}><div><p>이전 {days}일 평균</p><strong>{format(comparison.previous.average)} <span className={styles.muted}>mg/dL</span></strong><small>{comparison.previous.count}건</small><small>{previous.label}</small></div><span className={styles.arrow} aria-hidden="true">→</span><div><p>최근 {days}일 평균</p><strong>{format(comparison.current.average)} <span className={styles.muted}>mg/dL</span></strong><small>{comparison.current.count}건</small><small>{current.label}</small></div></div><p className={styles.note}>측정 상황과 식사 시간대가 모두 같은 기록만 비교해요. 시간대를 지정하지 않은 기록은 미지정끼리만 비교해요.</p></section>
        <section className={styles.panel}><h2>기록 비교 결과</h2>{comparison.comparable ? <><p className={styles.difference}>{comparison.difference === 0 ? "두 기간의 평균이 같아요." : `최근 평균이 ${differenceLabel} ${comparison.difference! > 0 ? "높게" : "낮게"} 기록됐어요.`}</p><p className={styles.muted}>{condition} · 이전 {comparison.previous.count}건 / 최근 {comparison.current.count}건</p></> : <p className={styles.difference}>한쪽 기간에 기록이 없어 비교할 수 없어요.</p>}<p className={styles.note}>측정 횟수와 시각이 다르면 평균도 달라질 수 있어요. 차이의 원인이나 건강 상태가 달라졌다고 단정할 수 없어요.</p></section></div>
      <section className={`${styles.panel} ${styles.lower}`}><RawRecords key={`current-${days}-${context}-${mealSlot}`} records={matching.filter(record => recordInRange(record, current))} caption={`최근 ${days}일 원본 기록`} /></section><section className={`${styles.panel} ${styles.lower}`}><RawRecords key={`previous-${days}-${context}-${mealSlot}`} records={matching.filter(record => recordInRange(record, previous))} caption={`이전 ${days}일 원본 기록`} /></section>
    </>}
  </AppShell>;
}
