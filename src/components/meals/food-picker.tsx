"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FoodCatalogItem, Nutrients } from "@/lib/domain/service-types";
import { api, errorMessage } from "@/lib/client/api";
import { InlineError } from "@/components/ui/page-parts";
import styles from "./meals.module.css";

const nutrientLabels: [keyof Nutrients, string, string][] = [["kcal", "열량", "kcal"], ["carbs_g", "탄수화물", "g"], ["sugars_g", "당류", "g"], ["protein_g", "단백질", "g"], ["fat_g", "지방", "g"], ["fiber_g", "식이섬유", "g"], ["sodium_mg", "나트륨", "mg"]];
export function NutritionValues({ nutrients, ratio = 1 }: { nutrients: Nutrients; ratio?: number }) {
  return <dl className={styles.nutrients}>{nutrientLabels.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{nutrients[key] === null ? "정보 없음" : `${Number((nutrients[key]! * ratio).toFixed(2)).toLocaleString("ko-KR")} ${unit}`}</dd></div>)}</dl>;
}

export function FoodPicker({ selectedIds, onSelect, onDirect, disabled }: { selectedIds: string[]; onSelect: (food: FoodCatalogItem) => void; onDirect: (name: string) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [foods, setFoods] = useState<FoodCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [direct, setDirect] = useState("");
  const [directError, setDirectError] = useState("");
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [randomized, setRandomized] = useState(false);
  const queryInput = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const search = async (text: string) => {
    const request = ++version.current;
    setLoading(true); setError("");
    try {
      const result = await api<{ foods: FoodCatalogItem[]; total?: number; matched_count?: number; truncated?: boolean; randomized?: boolean }>(`/api/foods?q=${encodeURIComponent(text.trim())}`);
      if (request !== version.current) return;
      setFoods(result.foods); setSearched(text.trim()); setTotal(result.matched_count ?? result.total ?? result.foods.length); setTruncated(result.truncated ?? false);
      setRandomized(result.randomized ?? false);
    } catch (cause) { if (request === version.current) setError(errorMessage(cause)); }
    finally { if (request === version.current) setLoading(false); }
  };
  const invalidate = useCallback(() => { ++version.current; }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void search(""); }); return () => { active = false; invalidate(); }; }, [invalidate]);
  return <section className={styles.panel} aria-labelledby="food-heading">
    <h2 id="food-heading">음식 추가</h2>
    <form className={styles.search} noValidate onSubmit={event => { event.preventDefault(); void search(query); }}>
      <label htmlFor="food-query">음식 이름<input ref={queryInput} id="food-query" type="text" value={query} maxLength={100} placeholder="김치, 밥, 두부 등" onChange={event => setQuery(event.target.value)} /></label>
      {query && <button type="button" className={styles.clearButton} aria-label="검색어 지우기" onClick={() => { setQuery(""); void search(""); queryInput.current?.focus(); }}>×</button>}
      <button className="button" disabled={loading} type="submit">{loading ? "검색 중" : "검색"}</button>
    </form>
    <p className={styles.hint}>이름의 일부로 검색할 수 있어요. 같은 음식도 재료와 조리법에 따라 영양값이 달라요.</p>
    {error && <InlineError>{error} 이름을 직접 입력해 식사에 추가할 수 있어요.</InlineError>}
    <p className={styles.hint} role="status">{loading ? "음식 정보를 불러오는 중이에요." : error ? "검색 결과를 확인하지 못했어요." : `${searched ? `‘${searched}’ 검색 결과` : "등록된 음식"} ${total.toLocaleString("ko-KR")}개${truncated ? ` 중 ${randomized ? "무작위로 고른 " : ""}${foods.length}개를 보여드려요. 이름을 더 입력하면 범위를 좁힐 수 있어요.` : ""}`}</p>
    {!loading && !error && foods.length === 0 && <p className={styles.empty}>검색된 음식이 없어요. 다른 이름을 검색하거나 아래에 직접 입력해 주세요.</p>}
    <ul className={styles.results} tabIndex={0} aria-label="음식 검색 결과">{!error && foods.map(food => <li className={styles.food} key={food.id}>
      <div className={styles.foodTop}><div><strong>{food.food_name}</strong><span>{food.basis_value}{food.basis_unit} 기준 · {food.kcal === null ? "열량 정보 없음" : `${food.kcal} kcal`}</span></div><button className="button secondary small" disabled={disabled || selectedIds.includes(food.id)} onClick={() => onSelect(food)} type="button" aria-label={`${food.food_name} ${selectedIds.includes(food.id) ? "추가됨" : "추가"}`}>{selectedIds.includes(food.id) ? "추가됨" : "+ 추가"}</button></div>
      <details><summary>{food.food_name} 영양정보·출처</summary>{!food.unit_validated && <p className={styles.hint}>원본에 적힌 기준량을 표시했어요. 단위 검증 전에는 섭취량을 환산하지 않아요.</p>}<NutritionValues nutrients={food} /><p className={styles.source}>원본 식품중량: {food.source_weight || "정보 없음"}<br />{food.source} · {food.source_version}<br />식품 코드 {food.source_code} · 확인 {food.checked_at?.slice(0, 10) || "정보 없음"}{food.source_url && <><br /><a href={food.source_url} target="_blank" rel="noreferrer">공식 원본 자료 보기 (새 창)</a></>}</p></details>
    </li>)}</ul>
    <form className={styles.direct} noValidate onSubmit={event => { event.preventDefault(); const name = direct.trim(); if (!name) { setDirectError("음식 이름을 입력해 주세요."); return; } onDirect(name); setDirect(""); setDirectError(""); }}>
      <label htmlFor="direct-food">음식 이름 직접 입력</label><input id="direct-food" type="text" value={direct} maxLength={200} onChange={event => { setDirect(event.target.value); setDirectError(""); }} disabled={disabled} aria-invalid={Boolean(directError)} aria-describedby={directError ? "direct-food-error" : "direct-food-help"} />
      {directError && <p id="direct-food-error" className="field-error">{directError}</p>}
      <p className={styles.hint} id="direct-food-help">직접 입력한 음식의 영양값은 정보 없음으로 남아요.</p><button className="button secondary" disabled={disabled} type="submit">직접 입력한 음식 추가</button>
    </form>
  </section>;
}
