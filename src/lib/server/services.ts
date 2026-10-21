import {createHash} from 'node:crypto';
import {benefitRules} from '../content/catalog';
import {isUuid,isTimestamp,queryRange,parseCsv,validateCsvRows,matchBenefit,CSV_MAX_BYTES,seoulDay,type RangeQuery,type MealRecord,type ImportBatch,type CsvMapping,type UserPreferences} from '../domain';
import {ApiError,noConsent,notFound} from './errors';
import type {RequestContext} from './session';
import {databaseError} from './records';
import {validateMeal,validatePreferences} from './service-validation';
import {localFoodCatalog} from './food-catalog';
const owner=(context:RequestContext)=>context.session.user!.id;
function range(query:RangeQuery){try{return queryRange(query);}catch{throw new ApiError(422,'INVALID_DATE','조회 기간을 확인해 주세요.');}}
function normalizeMeal(value:unknown,userId:string):MealRecord {
  const meal=value as MealRecord & {meal_items?:MealRecord['items']};
  const items=meal?.items??meal?.meal_items;
  if(!meal||!isUuid(meal.id)||meal.user_id!==userId||!isTimestamp(meal.meal_at)||!isTimestamp(meal.updated_at)||!Array.isArray(items)||items.some(item=>item.user_id!==userId||item.meal_id!==meal.id))throw new ApiError(503,'INVALID_DATA','식사 정보를 불러오지 못했어요.');
  const {meal_items:unused,...result}=meal;void unused;return {...result,items};
}
export async function listMeals(context:RequestContext,query:RangeQuery){
  const selected=range(query);if(context.store)return {meals:await context.store.listMeals(owner(context),selected),range:selected};
  const meals:MealRecord[]=[];const seen=new Set<string>();let cursor:MealRecord|undefined;
  while(true){
    let builder=context.supabase!.from('meal_records').select('*,meal_items(*)').eq('user_id',owner(context)).gte('meal_at',selected.start).lt('meal_at',selected.end).order('meal_at',{ascending:true}).order('id',{ascending:true}).limit(100);
    if(cursor)builder=builder.or(`meal_at.gt.${cursor.meal_at},and(meal_at.eq.${cursor.meal_at},id.gt.${cursor.id})`);
    const result=await builder;if(result.error)databaseError(result.error,false);if(!result.data?.length)break;
    for(const raw of result.data){const meal=normalizeMeal(raw,owner(context));if(seen.has(meal.id))throw new ApiError(503,'INCOMPLETE_DATA','식사 전체를 확인하지 못했어요. 다시 불러와 주세요.');seen.add(meal.id);meals.push(meal);cursor=meal;}
  }
  return {meals:meals.reverse(),range:selected};
}
export async function getMeal(context:RequestContext,id:string):Promise<MealRecord>{
  if(!isUuid(id))notFound();if(context.store)return context.store.getMeal(owner(context),id);
  const result=await context.supabase!.from('meal_records').select('*,meal_items(*)').eq('id',id).eq('user_id',owner(context)).maybeSingle();
  if(result.error)databaseError(result.error,false);if(!result.data)notFound();return normalizeMeal(result.data,owner(context));
}
export async function saveMeal(context:RequestContext,body:Record<string,unknown>,id?:string):Promise<MealRecord>{
  if(context.session.consent!=='current')noConsent();
  const input=validateMeal(body),recordId=id??body.id;if(!isUuid(recordId))throw new ApiError(422,'INVALID_INPUT','식사 번호를 확인해 주세요.');
  if(id&&('id'in body&&body.id!==id || !isTimestamp(body.expected_updated_at)))throw new ApiError(422,'INVALID_INPUT','최신 식사를 불러온 뒤 수정해 주세요.');
  if(context.store)return context.store.saveMeal(owner(context),recordId,input,input.items.some(item=>item.food_id)?(await localFoodCatalog()).foods:[],id?body.expected_updated_at as string:undefined);
  const result=await context.supabase!.rpc('save_meal_record',{p_id:recordId,p_meal:input,p_expected_updated_at:id?body.expected_updated_at:null});
  if(result.error)databaseError(result.error,true);return normalizeMeal(result.data,owner(context));
}
export async function removeMeal(context:RequestContext,id:string){
  if(!isUuid(id))notFound();if(context.store)return context.store.removeMeal(owner(context),id);
  const result=await context.supabase!.from('meal_records').delete().eq('id',id).eq('user_id',owner(context)).select('id');if(result.error)databaseError(result.error,true);if(!result.data?.length)notFound();
}
export async function getPreferences(context:RequestContext):Promise<UserPreferences|null>{
  if(context.store)return context.store.getPreferences(owner(context));const result=await context.supabase!.from('user_preferences').select('*').eq('user_id',owner(context)).maybeSingle();if(result.error)databaseError(result.error,false);return result.data;
}
export async function savePreferences(context:RequestContext,body:Record<string,unknown>):Promise<UserPreferences>{
  const input=validatePreferences(body);if(context.store)return context.store.savePreferences(owner(context),input);
  const result=await context.supabase!.rpc('save_user_preferences',{p_preferences:input});if(result.error)databaseError(result.error,true);return result.data;
}
export async function removePreferences(context:RequestContext){
  if(context.store)return context.store.removePreferences(owner(context));const result=await context.supabase!.from('user_preferences').delete().eq('user_id',owner(context));if(result.error)databaseError(result.error,true);
}
export async function searchFoods(context:RequestContext,query:string){
  const q=query.trim();if([...q].length>100)throw new ApiError(422,'INVALID_INPUT','검색어는 100자까지 입력해 주세요.');
  if(context.store){const catalog=await localFoodCatalog();const found=catalog.foods.filter(food=>food.status==='approved'&&food.food_name.toLocaleLowerCase('ko').includes(q.toLocaleLowerCase('ko')));return {foods:found.slice(0,100),total:catalog.foods.length,matched_count:found.length,truncated:found.length>100,limit:100,source:catalog.source};}
  let builder=context.supabase!.from('food_catalog').select('*',{count:'exact'}).eq('status','approved').order('food_name').limit(100);
  if(q)builder=builder.ilike('food_name',`%${q.replace(/[\\%_]/g,'\\$&')}%`);
  const result=await builder;if(result.error)databaseError(result.error,false);return {foods:result.data??[],matched_count:result.count,truncated:(result.count??0)>100,limit:100,source:'database'};
}
export async function listBenefits(context:RequestContext){
  let rules=benefitRules;
  if(context.supabase){const result=await context.supabase.from('benefit_rules').select('*').eq('status','approved');if(result.error)databaseError(result.error,false);rules=result.data??[];}
  const now=new Date(),today=seoulDay(now),preferences=await getPreferences(context);
  return {benefits:rules.filter(rule=>rule.status==='approved'&&Date.parse(rule.review_due_at)>now.getTime()&&(!rule.valid_from||rule.valid_from<=today)&&(!rule.valid_until||rule.valid_until>=today)).map(rule=>({rule,match:preferences?.matching_enabled?matchBenefit(rule,preferences):null}))};
}
export async function listNews(context:RequestContext){
  void context;
  return {articles:[],configured:false,refresh:{status:'unconfigured' as const,last_success_at:null,error:null,automatic:false}};
}
export async function getImport(context:RequestContext,requestId:string):Promise<ImportBatch>{
  if(!isUuid(requestId))notFound();if(context.store)return context.store.getImport(owner(context),requestId);
  const result=await context.supabase!.from('import_requests').select('import_batches(*)').eq('user_id',owner(context)).eq('request_id',requestId).maybeSingle();if(result.error)databaseError(result.error,false);if(!result.data)notFound();return result.data.import_batches as unknown as ImportBatch;
}
export async function importCsv(context:RequestContext,body:Record<string,unknown>){
  if(context.session.consent!=='current')noConsent();
  if(!isUuid(body.request_id)||typeof body.csv!=='string'||!body.mapping||typeof body.mapping!=='object'||Array.isArray(body.mapping))throw new ApiError(422,'INVALID_INPUT','파일과 연결한 열을 확인해 주세요.');
  if(Buffer.byteLength(body.csv,'utf8')>CSV_MAX_BYTES)throw new ApiError(413,'FILE_TOO_LARGE','CSV 파일은 2MiB까지 가져올 수 있어요.');
  let parsed;try{parsed=parseCsv(body.csv);}catch(error){throw new ApiError(422,'INVALID_CSV',error instanceof Error?error.message:'CSV를 읽지 못했어요.');}
  if(parsed.rows.some(row=>row.length!==parsed.headers.length))throw new ApiError(422,'INVALID_CSV','머리글과 데이터의 열 개수가 달라요.');
  const result=validateCsvRows(parsed.rows,body.mapping as CsvMapping);if(result.errors.length)throw new ApiError(422,'INVALID_CSV',result.errors.slice(0,5).map(error=>`${error.row}행: ${error.message}`).join(' '));
  const canonicalRows=result.records.map(record=>JSON.stringify(record)).sort();
  const fileHash=createHash('sha256').update(body.csv).digest('hex'),contentHash=createHash('sha256').update(`[${canonicalRows.join(',')}]`).digest('hex');
  if(context.store)return context.store.importRecords(owner(context),body.request_id,fileHash,contentHash,result.records);
  const saved=await context.supabase!.rpc('import_glucose_csv',{p_request_id:body.request_id,p_file_sha256:fileHash,p_records:result.records});
  if(saved.error?.code==='23505')throw new ApiError(409,'IMPORT_CONFLICT','같은 요청 번호의 내용이 달라요. 기존 결과를 확인한 뒤 파일을 다시 선택해 주세요.');
  if(saved.error)databaseError(saved.error,true);return saved.data as {batch:ImportBatch;duplicate:boolean};
}
