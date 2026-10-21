"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { BenefitMatch, BenefitRule, UserPreferences } from "@/lib/domain/service-types";
import { api, errorMessage } from "@/lib/client/api";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorState, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { ageLabels } from "./preferences-screen";
import styles from "./information.module.css";

type MatchedBenefit = { rule: BenefitRule; match: BenefitMatch | null };
function BenefitCard({ rule, match }: MatchedBenefit) {
  const state = match?.state;
  const stateLabel = state === "no_match" ? "선택 조건과 다름" : state === "match" ? "입력 조건 일치" : match ? "추가 확인 필요" : "공통 정책 정보";
  const remaining = match?.remaining || rule.criteria_json.additional_requirements;
  return <article className={styles.benefit}>
    <div className={styles.benefitTop}><span>{rule.agency}</span><span className={`${styles.state} ${state === "no_match" ? styles.noMatch : state === "match" ? styles.match : ""}`}>{stateLabel}</span></div>
    <h3>{rule.name}</h3><p>{rule.description}</p>
    <dl className={styles.evidence}>
      {match && <div><dt>조건 비교 근거</dt><dd>{match.reasons.length ? <ul>{match.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : "선택하지 않았거나 더 확인해야 할 조건이 있어요."}</dd></div>}
      {remaining.length > 0 && <div><dt>추가 확인</dt><dd><ul>{remaining.map(reason => <li key={reason}>{reason}</li>)}</ul></dd></div>}
    </dl>
    <div className={styles.source}><a href={rule.source_url} target="_blank" rel="noreferrer">지원 대상·신청 방법 확인 <span aria-hidden="true">↗</span><span className="sr-only"> (새 창)</span></a><p className={styles.muted}>원문 확인 {rule.checked_at.slice(0, 10)} · 재검토 기한 {rule.review_due_at.slice(0, 10)}</p></div>
  </article>;
}

export function BenefitsScreen() {
  const [benefits, setBenefits] = useState<MatchedBenefit[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active) return; setLoading(true); setError("");
      const results = await Promise.allSettled([api<{ benefits: MatchedBenefit[] }>("/api/benefits"), api<{ preferences: UserPreferences | null }>("/api/preferences")]);
      if (!active) return;
      const [policies, settings] = results;
      if (policies.status === "rejected" || settings.status === "rejected") setError(errorMessage(policies.status === "rejected" ? policies.reason : settings.status === "rejected" ? settings.reason : null));
      else { setBenefits(policies.value.benefits); setPreferences(settings.value.preferences); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [version]);
  const enabled = preferences?.matching_enabled === true;
  const related = benefits.filter(benefit => benefit.match?.state !== "no_match");
  const different = benefits.filter(benefit => benefit.match?.state === "no_match");
  const labels = preferences ? [preferences.region, preferences.age_band ? ageLabels[preferences.age_band] : null, preferences.diagnosed === null ? null : preferences.diagnosed ? "당뇨병 진단받음" : "당뇨병 진단받지 않음", preferences.insulin_use === null ? null : preferences.insulin_use ? "인슐린 사용" : "인슐린 미사용"].filter(Boolean) : [];
  return <AppShell><PageHeading title="맞춤 정책·혜택" description="공식 제도의 조건을 확인하고 신청 기관의 안내로 이어가세요." />
    {loading ? <LoadingState label="정책과 맞춤 조건을 불러오는 중이에요." /> : error ? <ErrorState message={error} retry={() => setVersion(value => value + 1)} /> : <div className={styles.layout}>
      <section className={styles.panel} aria-labelledby="conditions-heading"><h2 id="conditions-heading">내 맞춤 조건</h2>
        {labels.length ? <div className={styles.conditions}>{labels.map(label => <span className={styles.condition} key={label}>{label}</span>)}</div> : <p className={styles.muted}>선택한 조건이 없어요. 설정에서 필요한 조건만 입력할 수 있어요.</p>}
        {!enabled && <p className={styles.muted}>맞춤 선별이 꺼져 있어 공통 정책 정보를 보여드려요.</p>}
        <div className={styles.sectionHeading}><h2>{enabled ? "관련 지원제도" : "공식 지원제도"}</h2><span className={styles.muted}>{related.length}건</span></div>
        <div className={styles.list}>{related.map(benefit => <BenefitCard key={benefit.rule.id} {...benefit} />)}</div>
        {related.length === 0 && <p className={styles.note}>{benefits.length ? "현재 선택 조건과 관련된 제도가 없어요. 조건을 확인하거나 다른 제도의 공식 요건을 살펴보세요." : "현재 검토가 완료된 정책 정보가 없어요."}</p>}
        {different.length > 0 && <details><summary className={styles.sectionHeading}>선택 조건과 다른 제도 {different.length}건</summary><div className={styles.list}>{different.map(benefit => <BenefitCard key={benefit.rule.id} {...benefit} />)}</div></details>}
      </section>
      <aside className={styles.panel} aria-labelledby="benefit-status"><h2 id="benefit-status">{enabled ? "조건 확인 결과" : "정책 안내"}</h2><div className={styles.stat}><span>{enabled ? "관련 제도" : "확인 가능한 제도"}</span><strong>{related.length}건</strong></div><p className={styles.note}>지역·연령대 등 선택한 정보만으로 지원 자격을 확정할 수 없어요. 진단·등록·처방 등 세부 요건은 공식 신청 기관에서 확인해 주세요.</p><div className={styles.panelActions}><Link className="button secondary" href="/preferences">{preferences ? "맞춤 조건 수정" : "맞춤 조건 설정"}</Link><p className={styles.muted}>확인되지 않은 조건은 ‘추가 확인 필요’로 남겨요. 기록한 혈당으로 진단 여부를 추정하지 않아요.</p></div></aside>
    </div>}
  </AppShell>;
}
