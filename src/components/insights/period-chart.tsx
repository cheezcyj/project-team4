"use client";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DateRange, GlucoseRecord } from "@/lib/domain";
import { contexts, displayTime } from "@/lib/client/display";
import styles from "./insights.module.css";
export function PeriodChart({ records, range, days }: { records: GlucoseRecord[]; range: DateRange; days: number }) {
  const start = Date.parse(range.start), end = Date.parse(range.end) - 1;
  const points = [...records].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at) || a.id.localeCompare(b.id)).map(record => ({ ...record, time: Date.parse(record.measured_at) }));
  const ticks = [start, start + Math.floor((days - 1) / 2) * 86_400_000, start + (days - 1) * 86_400_000];
  const dayLabel = (value: number) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(value));
  const number = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
  return <div className={styles.chart} role="img" aria-label={`최근 ${days}일 혈당 선·점 그래프, 실제 측정 ${records.length}건. 모든 값은 아래 원본 혈당 기록에서 확인할 수 있어요.`}>
    <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 18, right: 18, bottom: 8, left: 0 }}>
      <CartesianGrid vertical={false} stroke="#e2eaf0" /><XAxis type="number" dataKey="time" domain={[start, end]} ticks={ticks} tickFormatter={dayLabel} tickLine={false} axisLine={{ stroke: "#cbd9e3" }} padding={{ left: 8, right: 8 }} /><YAxis type="number" dataKey="glucose_mg_dl" domain={["auto", "auto"]} allowDecimals={false} tickLine={false} axisLine={false} width={60} tickFormatter={value => Number(value) >= 10000 ? number.format(Number(value)) : String(value)} />
      <Tooltip cursor={false} content={({ active, payload }) => { const record = payload?.[0]?.payload as GlucoseRecord | undefined; return active && record ? <div className="chart-tooltip"><strong>{record.glucose_mg_dl.toLocaleString("ko-KR")} mg/dL</strong><span>{displayTime(record.measured_at)}</span><span>{contexts[record.measurement_context]}</span></div> : null; }} /><Scatter data={points} fill="#1589a4" line={{ stroke: "#1589a4", strokeWidth: 2 }} lineType="joint" isAnimationActive={false} />
    </ScatterChart></ResponsiveContainer>
  </div>;
}
