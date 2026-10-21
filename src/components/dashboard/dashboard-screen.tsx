"use client";
import Link from "next/link";
import { contexts, displayTime } from "@/lib/client/display";
import { useAppSession } from "@/components/auth/app-gate";
import { ConsentNotice } from "@/components/auth/consent-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { RecordTable } from "@/components/records/record-table";
import { useRecords } from "@/components/records/use-records";
import { GlucoseChart } from "@/components/dashboard/glucose-chart";
import { summarizeGlucose } from "@/lib/domain/analytics";
import { seoulDay } from "@/lib/domain";
export function DashboardScreen() {
  const session = useAppSession();
  const { data, error, load } = useRecords();
  const latest = data?.records[0];
  const summary = data ? summarizeGlucose(data.records) : null;
  return <AppShell>
    <PageHeading
      title="혈당 한눈에"
      description="혈당과 식사를 기록하고, 나의 기록을 함께 살펴봐요."
      action={session.consent === "current" && <div className="dashboard-actions"><Link className="button" href="/records/new">
        <span aria-hidden="true">＋</span> 혈당 기록하기</Link><Link className="button secondary" href="/meals/new">식사 기록하기</Link></div>} />
    <ConsentNotice />
    {error ? <ErrorState message={error} retry={() => void load()} /> : !data ? <LoadingState /> : data.records.length === 0 ? <div className="state-box empty-state">
      <span className="empty-icon" aria-hidden="true">＋</span>
      <h2>최근 7일에 남긴 기록이 없어요.</h2>
      <p>측정한 값을 기록하면 이곳에 그래프와 목록이 보여요.</p>
      {session.consent === "current" && <Link className="button" href="/records/new">첫 혈당 기록하기</Link>}
      <Link href="/records">다른 날짜의 기록 찾기</Link>
    </div> : <>
      <dl className="summary-strip">
        <div className="summary-stat"><dt>최근 7일 평균</dt><dd>{summary!.average!.toLocaleString("ko-KR", {maximumFractionDigits: 1})}<span>mg/dL</span></dd></div>
        <div className="summary-stat"><dt>최고 혈당</dt><dd>{summary!.max!.toLocaleString("ko-KR")}<span>mg/dL</span></dd></div>
        <div className="summary-stat"><dt>최저 혈당</dt><dd>{summary!.min!.toLocaleString("ko-KR")}<span>mg/dL</span></dd></div>
        <div className="summary-stat"><dt>기록한 날</dt><dd>{new Set(data.records.map(item => seoulDay(item.measured_at))).size}<span>일 / 7일</span></dd></div>
      </dl>
      <div className="dashboard-grid">
        <section className="latest-panel" aria-labelledby="latest-heading">
          <p className="eyebrow">최근 7일 중</p>
          <h2 id="latest-heading">가장 최근 기록</h2>
          <p className={`latest-value ${latest!.glucose_mg_dl >= 1000000 ? "long-value" : ""}`}>
            <strong>
              {latest!.glucose_mg_dl.toLocaleString("ko-KR")}
            </strong>
            <span>mg/dL</span>
          </p>
          <p className="latest-context">
            {contexts[latest!.measurement_context]}
          </p>
          <time dateTime={latest!.measured_at}>
            {displayTime(latest!.measured_at)}
          </time>
          <Link href={`/records/${latest!.id}/edit`}>기록 자세히 보기 <span aria-hidden="true">↗</span>
          </Link>
        </section>
        <section className="chart-panel" aria-labelledby="chart-heading">
          <div className="section-heading">
            <div>
              <h2 id="chart-heading">최근 7일 혈당</h2>
              <p>
                {data.range.label}
              </p>
            </div>
            <span className="chart-unit">mg/dL</span>
          </div>
          <GlucoseChart records={data.records} start={data.range.start} end={data.range.end} />
          <p className="chart-note">점은 실제 측정값이고, 선은 시간순으로 이은 표시예요. 측정하지 않은 날의 값은 알 수 없어요.</p>
          {summary!.mixedContexts && <p className="chart-note">서로 다른 측정 상황이 섞인 평균이에요. 같은 상황의 변화는 <Link href="/comparison">기간 비교</Link>에서 확인해요.</p>}
        </section>
      </div>
      <section className="recent-records">
        <div className="section-heading">
          <h2>최근 7일 기록 <span className="count">
            {data.records.length}건</span>
          </h2>
          <Link href="/records">전체 보기 <span aria-hidden="true">→</span>
          </Link>
        </div>
        <RecordTable records={data.records} caption="그래프와 같은 최근 7일 기록" />
      </section>
    </>}
  </AppShell>;
}
