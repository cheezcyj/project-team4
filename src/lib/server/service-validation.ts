import {randomUUID} from 'node:crypto';
import {isTimestamp,isUuid,mealTypes,PREFERENCES_NOTICE_VERSION,type MealInput,type MealItem,type MealRecord,type FoodCatalogItem,type PreferencesInput,type MealItemInput} from '../domain';
import {ApiError} from './errors';
function invalid(message='입력한 내용을 확인해 주세요.'):never {throw new ApiError(422,'INVALID_INPUT',message);}
function text(value:unknown,max:number):string|null {if(value==null||value==='')return null;if(typeof value!=='string'||[...value.trim()].length>max)invalid();return value.trim()||null;}
export function validateMeal(body:Record<string,unknown>):MealInput {
  for(const key of ['user_id','created_at','updated_at'])if(key in body)invalid('변경할 수 없는 값이 포함되어 있어요.');
  if(!isTimestamp(body.meal_at)||!mealTypes.some(item=>item.value===body.meal_type)||!Array.isArray(body.items)||body.items.length>100)invalid('식사 시각과 종류, 음식 항목을 확인해 주세요.');
  const items:MealItemInput[]=body.items.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid();
    const item=raw as Record<string,unknown>;
    if(Object.keys(item).some(key=>!['id','food_id','free_text','amount_value','amount_unit'].includes(key)))invalid('음식 선택값만 전송해 주세요.');
    if(item.id!==undefined&&!isUuid(item.id))invalid();
    if(item.food_id!=null&&!isUuid(item.food_id))invalid();
    const free_text=text(item.free_text,200),amount_unit=text(item.amount_unit,40);
    if(item.amount_value!=null&&typeof item.amount_value!=='number')invalid('섭취량은 숫자로 입력해 주세요.');
    const amount_value=item.amount_value==null?null:Number(item.amount_value);
    if(!item.food_id&&!free_text)invalid('음식을 선택하거나 이름을 입력해 주세요.');
    if((amount_value===null)!==(amount_unit===null)||amount_value!==null&&(!Number.isFinite(amount_value)||amount_value<=0||amount_value>=100000000||Number(amount_value.toFixed(4))!==amount_value))invalid('섭취량은 양수와 단위를 함께 입력해 주세요.');
    return {id:item.id as string|undefined,food_id:(item.food_id as string|null)??null,free_text,amount_value,amount_unit};
  });
  const ids=items.flatMap(item=>item.id?[item.id]:[]);if(new Set(ids).size!==ids.length)invalid('음식 항목 번호가 겹쳐요.');
  const memo=text(body.memo,500);if(!items.length&&!memo)invalid('음식이나 식사 메모를 입력해 주세요.');
  return {meal_at:new Date(body.meal_at as string).toISOString(),meal_type:body.meal_type as MealInput['meal_type'],memo,items};
}
export function materializeMeal(input:MealInput,id:string,userId:string,foods:FoodCatalogItem[],old?:MealRecord):MealRecord {
  const now=new Date(Math.max(Date.now(),old?Date.parse(old.updated_at)+1:0)).toISOString();
  const items:MealItem[]=input.items.map(item=>{
    const prior=old?.items.find(previous=>previous.id===item.id);
    const food=item.food_id?foods.find(food=>food.id===item.food_id&&food.status==='approved'):null;
    const preserved=prior && prior.food_id===item.food_id?prior.nutrition_snapshot:null;
    if(item.food_id&&!food&&!preserved)invalid('선택한 음식 정보를 확인해 주세요.');
    const snapshot=preserved??(food?{schema_version:1 as const,food_name:food.food_name,source_code:food.source_code,source:food.source,source_version:food.source_version,source_sha256:food.source_sha256,basis_value:food.basis_value,basis_unit:food.basis_unit,nutrients:{kcal:food.kcal,carbs_g:food.carbs_g,sugars_g:food.sugars_g,protein_g:food.protein_g,fat_g:food.fat_g,fiber_g:food.fiber_g,sodium_mg:food.sodium_mg},unit_validated:food.unit_validated,captured_at:now}:null);
    const conversion_state=!item.amount_value?'not_calculated':!snapshot?.unit_validated||item.amount_unit!==snapshot.basis_unit?'unavailable':item.amount_value===snapshot.basis_value?'same_basis':'verified';
    return {id:item.id??randomUUID(),meal_id:id,user_id:userId,food_id:item.food_id??null,free_text:item.free_text??null,amount_value:item.amount_value??null,amount_unit:item.amount_unit??null,nutrition_snapshot:snapshot,conversion_state,created_at:prior?.created_at??now,updated_at:now};
  });
  return {...input,id,user_id:userId,created_at:old?.created_at??now,updated_at:now,items};
}
export function validatePreferences(body:Record<string,unknown>):PreferencesInput {
  if(Object.keys(body).some(key=>!['region','age_band','diagnosed','insulin_use','matching_enabled','notice_version'].includes(key)))invalid();
  const region=text(body.region,80),age_band=body.age_band??null;
  if(age_band!==null&&!['under_19','19_39','40_64','65_plus'].includes(String(age_band)))invalid();
  for(const key of ['diagnosed','insulin_use'])if(body[key]!=null&&typeof body[key]!=='boolean')invalid();
  if(typeof body.matching_enabled!=='boolean'||body.notice_version!==PREFERENCES_NOTICE_VERSION)invalid('맞춤 정보 안내를 확인해 주세요.');
  return {region,age_band:age_band as PreferencesInput['age_band'],diagnosed:body.diagnosed as boolean??null,insulin_use:body.insulin_use as boolean??null,matching_enabled:body.matching_enabled,notice_version:PREFERENCES_NOTICE_VERSION};
}
