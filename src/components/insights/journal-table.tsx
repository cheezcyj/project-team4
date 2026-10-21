"use client";
import Link from "next/link";
import type { GlucoseRecord, MealRecord } from "@/lib/domain";
import { mealSlots, mealTypes } from "@/lib/domain";
import { contexts, displayTime } from "@/lib/client/display";
import styles from "./insights.module.css";
export type JournalEntry = { kind: "glucose"; time: string; record: GlucoseRecord } | { kind: "meal"; time: string; record: MealRecord };
export function journalEntries(records: GlucoseRecord[], meals: MealRecord[]): JournalEntry[] {
  return [...records.map(record => ({ kind: "glucose" as const, time: record.measured_at, record })), ...meals.map(record => ({ kind: "meal" as const, time: record.meal_at, record }))]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || b.record.id.localeCompare(a.record.id) || a.kind.localeCompare(b.kind));
}
export function JournalTable({ entries, caption = "혈당·식사 통합 일지" }: { entries: JournalEntry[]; caption?: string }) {
  return <table className={styles.table}>
    <caption className="sr-only">{caption} · 최신 시각순 · 한국 시간</caption>
    <thead><tr><th scope="col">기록 시각</th><th scope="col">종류</th><th scope="col">기록 내용</th><th scope="col"><span className="sr-only">기록 열기</span></th></tr></thead>
    <tbody>{entries.map(entry => <tr key={`${entry.kind}-${entry.record.id}`}>
      <td><time dateTime={entry.time}>{displayTime(entry.time)}</time></td>
      <td><span className={`${styles.kind} ${entry.kind === "meal" ? styles.meal : ""}`}>{entry.kind === "glucose" ? "혈당" : "식사"}</span></td>
      <td>{entry.kind === "glucose" ? <><strong>{entry.record.glucose_mg_dl.toLocaleString("ko-KR")} mg/dL</strong><small>{contexts[entry.record.measurement_context]}{entry.record.meal_slot ? ` · ${mealSlots.find(slot => slot.value === entry.record.meal_slot)?.label}` : ""}</small>{entry.record.meal_memo && <small>{entry.record.meal_memo}</small>}</> : <><strong>{entry.record.items.map(item => item.nutrition_snapshot?.food_name || item.free_text).filter(Boolean).join(", ") || "식사 메모"}</strong><small>{mealTypes.find(type => type.value === entry.record.meal_type)?.label} 식사</small>{entry.record.memo && <small>{entry.record.memo}</small>}</>}</td>
      <td><Link href={entry.kind === "glucose" ? `/records/${entry.record.id}/edit` : `/meals/${entry.record.id}/edit`} aria-label={`${displayTime(entry.time)} ${entry.kind === "glucose" ? `${entry.record.glucose_mg_dl} mg/dL` : "식사"} 기록 보기`}>보기</Link></td>
    </tr>)}</tbody>
  </table>;
}
