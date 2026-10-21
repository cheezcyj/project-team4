"use client";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { compareRecordsAscending, type GlucoseRecord } from "@/lib/domain";
import { contexts, displayTime } from "@/lib/client/display";
export function GlucoseChart({ records, start, end }: {
  records: GlucoseRecord[];
  start: string;
  end: string;
}) {
  // 실제 측정점을 시간순으로 연결해요. 미측정 날짜에 값이나 점을 추가하지 않아요.
  const points = [...records].sort(compareRecordsAscending).map(record => ({ ...record, time: new Date(record.measured_at).getTime() }));
  const dayLabel = (value: number) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(value));
  const firstDay = new Date(start).getTime();
  const lastDay = new Date(end).getTime() - 1;
  const ticks = [firstDay, firstDay + 3 * 86400000, firstDay + 6 * 86400000];
  const axisNumber = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
  return <div
    className="chart"
    role="img"
    aria-label={`최근 7일 혈당 그래프. 실제 측정점과 연결선, 총 ${records.length}건. 같은 기록을 아래 표에서 확인할 수 있어요.`}>
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 6, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-line)" />
        <XAxis
          type="number"
          dataKey="time"
          domain={[firstDay, lastDay]}
          ticks={ticks}
          tickFormatter={dayLabel}
          tickLine={false}
          axisLine={{ stroke: "var(--color-line-strong)" }}
          minTickGap={20}
          padding={{ left: 6, right: 6 }} />
        <YAxis
          type="number"
          dataKey="glucose_mg_dl"
          domain={["auto", "auto"]}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={value => Number(value) >= 10000 ? axisNumber.format(Number(value)) : Number(value).toLocaleString("ko-KR")} />
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            const record = payload?.[0]?.payload as GlucoseRecord | undefined;
            return active && record ? <div className="chart-tooltip">
              <strong>
                {record.glucose_mg_dl.toLocaleString("ko-KR")} mg/dL</strong>
              <span>
                {displayTime(record.measured_at)}
              </span>
              <span>
                {contexts[record.measurement_context]}
              </span>
            </div> : null;
          }} />
        <Scatter data={points} fill="var(--color-primary)" line={points.length > 1 ? { stroke: "var(--color-primary)", strokeWidth: 2 } : false} lineType="joint" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  </div>;
}
