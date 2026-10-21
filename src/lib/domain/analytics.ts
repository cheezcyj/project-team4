import type { GlucoseRecord } from './types';
import type { ComparisonFilter, MealRecord, Nutrients, Periods, UserPreferences, BenefitRule, BenefitMatch } from './service-types';
import { recordInRange } from './records';

export function summarizeGlucose(records: GlucoseRecord[]) {
  const values = records.map(record=>record.glucose_mg_dl);
  const contexts = [...new Set(records.map(record=>record.measurement_context))];
  return {count:values.length,average:values.length ? values.reduce((a,b)=>a+b,0)/values.length : null,min:values.length ? Math.min(...values) : null,max:values.length ? Math.max(...values) : null,contexts,mixedContexts:contexts.length>1};
}
export function comparePeriods(records: GlucoseRecord[], periods: Periods, filter: ComparisonFilter) {
  const matching=records.filter(record=>record.measurement_context===filter.measurement_context && (record.meal_slot??null)===filter.meal_slot);
  const current=summarizeGlucose(matching.filter(record=>recordInRange(record,periods.current)));
  const previous=summarizeGlucose(matching.filter(record=>recordInRange(record,periods.previous)));
  const comparable=current.count>0 && previous.count>0 && Date.parse(periods.current.end)-Date.parse(periods.current.start)===Date.parse(periods.previous.end)-Date.parse(periods.previous.start) && periods.previous.end===periods.current.start;
  return {current,previous,comparable,difference:comparable ? current.average!-previous.average! : null};
}
export function summarizeMeals(meals: MealRecord[]) { return {count:meals.length}; }
export function itemNutrients(item: MealRecord['items'][number]): Nutrients | null {
  const snap=item.nutrition_snapshot;
  if (!snap?.unit_validated || item.amount_value == null || item.amount_unit!==snap.basis_unit || snap.basis_value<=0) return null;
  return Object.fromEntries(Object.entries(snap.nutrients).map(([key,value])=>[key,value===null?null:value*item.amount_value!/snap.basis_value])) as Nutrients;
}
export function matchBenefit(rule: BenefitRule, preferences: UserPreferences): BenefitMatch {
  const reasons:string[]=[],remaining:string[]=[...rule.criteria_json.additional_requirements];
  let mismatch=false;
  function check(value:boolean|null,yes:string,no:string,unknown:string) { if(value===true) reasons.push(yes); else if(value===false) {mismatch=true;reasons.push(no);} else remaining.push(unknown); }
  if (!rule.region_scope.includes('all')) check(preferences.region ? rule.region_scope.includes(preferences.region):null,'선택한 지역과 일치해요.','선택한 지역은 적용 지역과 달라요.','적용 지역을 확인해 주세요.');
  const criteria=rule.criteria_json;
  if(criteria.min_age!==undefined || criteria.max_age!==undefined){
    const ages={under_19:[0,18],'19_39':[19,39],'40_64':[40,64],'65_plus':[65,Infinity]};
    const band=preferences.age_band?ages[preferences.age_band]:null, min=criteria.min_age??0,max=criteria.max_age??Infinity;
    check(band ? (band[0]>=min && band[1]<=max ? true : band[1]<min||band[0]>max ? false : null) : null,'선택한 연령대가 조건에 들어가요.','선택한 연령대는 조건과 달라요.','정확한 대상 연령을 원문에서 확인해 주세요.');
  }
  for(const key of ['diagnosed','insulin_use'] as const) if(criteria[key]!==undefined) check(preferences[key]===null?null:preferences[key]===criteria[key],key==='diagnosed'?'선택한 진단 여부와 일치해요.':'선택한 인슐린 사용 여부와 일치해요.','선택한 조건이 제도 조건과 달라요.',key==='diagnosed'?'진단 조건을 확인해 주세요.':'인슐린 사용 조건을 확인해 주세요.');
  return {state:mismatch?'no_match':remaining.length?'needs_review':'match',reasons,remaining};
}
