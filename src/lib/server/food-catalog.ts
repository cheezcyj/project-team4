import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {foodCatalog} from '../content/catalog';
import {isTimestamp,isUuid,type FoodCatalogItem} from '../domain';
import {ApiError} from './errors';

type Cache={filename:string;mtime:number;size:number;records:FoodCatalogItem[]};
const registry=globalThis as typeof globalThis & {__foodCatalogCache?:Cache};
export async function localFoodCatalog():Promise<{foods:FoodCatalogItem[];source:'local'|'built_in'}>{
 const workspaceRoot=process.env.DEMO_WORKSPACE_ROOT??process.cwd();
 const filename=path.resolve(workspaceRoot,process.env.FOOD_CATALOG_FILE??path.join('.local','food-catalog.json'));
 try{
  const info=await stat(/* turbopackIgnore: true */ filename),cache=registry.__foodCatalogCache;
  if(cache?.filename===filename&&cache.mtime===info.mtimeMs&&cache.size===info.size)return {foods:cache.records,source:'local'};
  if(info.size>150*1024*1024)throw new Error('Catalog exceeds allowed size');
  const parsed:unknown=JSON.parse(await readFile(/* turbopackIgnore: true */ filename,'utf8'));
  if(!parsed||typeof parsed!=='object')throw new Error('Invalid catalog');
  const artifact=parsed as {schema_version:number;records_count:number;records_sha256:string;source_sha256:string;include_built_in?:boolean;records:FoodCatalogItem[]};
  if(artifact.schema_version!==1||!Array.isArray(artifact.records)||artifact.records.length!==artifact.records_count||artifact.records_count<1||artifact.records_count>100000||!/^[0-9a-f]{64}$/.test(artifact.source_sha256)||createHash('sha256').update(JSON.stringify(artifact.records)).digest('hex')!==artifact.records_sha256)throw new Error('Catalog integrity mismatch');
  const seen=new Set<string>();
  for(const item of artifact.records){
   if(!item||!isUuid(item.id)||seen.has(item.id)||typeof item.food_name!=='string'||!item.food_name||item.source_sha256!==artifact.source_sha256||!isTimestamp(item.checked_at)||!['g','ml'].includes(item.basis_unit)||!Number.isFinite(item.basis_value)||item.basis_value<=0||item.status!=='approved'||item.unit_validated!==false)throw new Error('Invalid catalog record');
   for(const key of ['kcal','carbs_g','sugars_g','protein_g','fat_g','fiber_g','sodium_mg'] as const)if(item[key]!==null&&(!Number.isFinite(item[key])||Number(item[key])<0))throw new Error('Invalid catalog nutrient');
   seen.add(item.id);
  }
  // 팀 공통 발췌본만 기본 8개를 합쳐요. 별도 CSV 가져오기의 기존 동작은 유지해요.
  const records=artifact.include_built_in===true?[...foodCatalog.filter(food=>!seen.has(food.id)),...artifact.records]:artifact.records;
  registry.__foodCatalogCache={filename,mtime:info.mtimeMs,size:info.size,records};return {foods:records,source:'local'};
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return {foods:foodCatalog,source:'built_in'};
  throw new ApiError(503,'FOOD_CATALOG_UNAVAILABLE','음식 자료를 불러오지 못했어요. 직접 이름을 입력하거나 잠시 후 다시 확인해 주세요.');
 }
}
