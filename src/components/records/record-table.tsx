"use client";
import Link from "next/link";
import type { GlucoseRecord } from "@/lib/domain";
import { contexts, displayTime } from "@/lib/client/display";
import { mealSlots } from "@/lib/domain/service-types";
export function RecordTable({ records, caption = "혈당 기록", showMemo = false }: {
  records: GlucoseRecord[];
  caption?: string;
  showMemo?: boolean;
}) {
  return <div className="records-table-wrap">
    <table className={`records-table ${showMemo ? "with-memo" : ""}`}>
      <caption className="sr-only">
        {caption} · 한국 시간 · 혈당 단위 mg/dL</caption>
      <thead>
        <tr>
          <th scope="col">측정 시각</th>
          <th scope="col">혈당</th>
          <th scope="col">측정 상황</th>
          {showMemo && <th scope="col">식사 메모</th>}
          <th scope="col">
            <span className="sr-only">기록 열기</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {records.map(record => <tr key={record.id}>
          <td className="record-time">
            <time dateTime={record.measured_at}>
              {displayTime(record.measured_at)}
            </time>
          </td>
          <td className="record-value">
            <strong>
              {record.glucose_mg_dl.toLocaleString("ko-KR")}
            </strong> <span>mg/dL</span>
          </td>
          <td className="record-context">
            {contexts[record.measurement_context]}
            {record.meal_slot && <span> · {mealSlots.find(slot => slot.value === record.meal_slot)?.label}</span>}
          </td>
          {showMemo && <td className="record-memo">
            {record.meal_memo || "—"}
          </td>}
          <td className="record-link">
            <Link
              href={`/records/${record.id}/edit`}
              aria-label={`${displayTime(record.measured_at)} ${record.glucose_mg_dl} mg/dL 기록 보기`}>보기 <span aria-hidden="true">↗</span>
            </Link>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
