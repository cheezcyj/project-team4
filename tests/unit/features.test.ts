import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseCsv,validateCsvRows,validateRecord,contexts,monthRange,queryRange,previousRange,summarizeGlucose,comparePeriods,itemNutrients,matchBenefit,type GlucoseRecord,type UserPreferences,type BenefitRule} from '../../src/lib/domain';
import {DemoStore,DEMO_USERS} from '../../src/lib/server/demo-store';
import {materializeMeal,validateMeal,validatePreferences} from '../../src/lib/server/service-validation';
import {foodCatalog,benefitRules} from '../../src/lib/content/catalog';
import {importCsv,searchFoods,listNews,saveMeal} from '../../src/lib/server/services';
import type {RequestContext} from '../../src/lib/server/session';
import {ApiError} from '../../src/lib/server/errors';

const record={glucose_mg_dl:110,measured_at:'2026-10-21T03:00:00.000Z',measurement_context:'after_meal' as const,meal_slot:'lunch' as const,meal_memo:null};
test('ten measurement contexts preserve original codes and validate optional meal association',()=>{
 assert.equal(contexts.length,10);
 for(const context of contexts)assert.equal(validateRecord({...record,meal_slot:null,measurement_context:context.value}).ok,true);
 assert.equal(validateRecord({...record,measurement_context:'fasting'}).ok,false);
 assert.equal(validateRecord({...record,meal_slot:'other'}).ok,false);
 assert.equal(validateRecord({...record,meal_slot:undefined}).ok,true);
});
test('month and custom ranges use Seoul calendar boundaries and reject inconsistent filters',()=>{
 assert.deepEqual(monthRange('2024-02'),{start:'2024-01-31T15:00:00.000Z',end:'2024-02-29T15:00:00.000Z',label:'2024-02'});
 assert.equal(monthRange('2026-12').end,'2026-12-31T15:00:00.000Z');
 assert.throws(()=>queryRange({days:7,month:'2026-10'}));assert.throws(()=>queryRange({days:15}));assert.throws(()=>queryRange({start:'2026-10-22',end:'2026-10-21'}));
 const range=queryRange({start:'2026-10-15',end:'2026-10-21'});assert.equal(previousRange(range).end,range.start);assert.equal(previousRange(range).start,'2026-10-07T15:00:00.000Z');
});
test('reports retain null for empty data, actual single values and exact comparison context',()=>{
 assert.equal(summarizeGlucose([]).average,null);
 const first={...record,id:randomUUID()} as GlucoseRecord, second={...first,id:randomUUID(),glucose_mg_dl:120,measured_at:'2026-10-14T03:00:00.000Z'};
 const current=queryRange({start:'2026-10-15',end:'2026-10-21'}),previous=previousRange(current);
 assert.equal(summarizeGlucose([first]).average,110);
 assert.equal(comparePeriods([first,second],{current,previous},{measurement_context:'after_meal',meal_slot:'lunch'}).difference,-10);
 assert.equal(comparePeriods([first,second],{current,previous},{measurement_context:'after_meal',meal_slot:'breakfast'}).comparable,false);
 assert.equal(summarizeGlucose([first,{...second,measurement_context:'fasting'}]).mixedContexts,true);
});
test('CSV handles BOM quoted commas, quotes, multiline memo and Korean aliases without evaluating text',()=>{
 const text='\uFEFF혈당,시각,상황,시간대,메모,단위\r\n110,2026-10-21 12:00,식후,점심,"=SUM(1,2)\n""글""",mg/dL\r\n';
 const parsed=parseCsv(text);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0][4],'=SUM(1,2)\n"글"');
 const result=validateCsvRows(parsed.rows,{glucose_mg_dl:0,measured_at:1,measurement_context:2,meal_slot:3,meal_memo:4,unit:5});assert.deepEqual(result.errors,[]);assert.equal(result.records[0].measured_at,'2026-10-21T03:00:00.000Z');assert.equal(result.records[0].meal_slot,'lunch');
});
test('CSV rejects malformed quoting, invalid Unicode, too many rows, bad units and every row on any validation failure',()=>{
 for(const text of ['a,b\n"unfinished,b','a,b\n"x"junk,b','a,b\n\ufffd,b','a,b\n'+('1,2\n'.repeat(1001))])assert.throws(()=>parseCsv(text));
 const mapping={glucose_mg_dl:0,measured_at:1,measurement_context:2,unit:3};
 const result=validateCsvRows([['110','2026-10-21T12:00','공복','mg/dL'],['0','2026-02-30T12:00','공복','mmol/L']],mapping);assert.equal(result.records.length,0);assert.equal(result.errors[0].row,2);
 assert.equal(validateCsvRows([['110']],{glucose_mg_dl:0,measured_at:0,measurement_context:0}).errors[0].row,0);
});
test('meal validator blocks client supplied snapshots, invalid pairs and empty records',()=>{
 const input={meal_at:record.measured_at,meal_type:'lunch',memo:null,items:[{free_text:'사과',amount_value:1,amount_unit:'개'}]};assert.equal(validateMeal(input).items.length,1);
 assert.throws(()=>validateMeal({...input,items:[{free_text:'사과',nutrition_snapshot:{kcal:1}}]}));assert.throws(()=>validateMeal({...input,items:[]}));assert.throws(()=>validateMeal({...input,items:[{free_text:'사과',amount_value:1}]}));
 for(const amount of [true,false,[1],{value:1},'1'])assert.throws(()=>validateMeal({...input,items:[{free_text:'사과',amount_value:amount,amount_unit:'g'}]}));
 assert.equal(validateMeal({...input,items:[{free_text:'사과',amount_value:1.2345,amount_unit:'g'}]}).items[0].amount_value,1.2345);
 assert.throws(()=>validatePreferences({matching_enabled:true,notice_version:'old'}));
});
test('meal snapshots preserve historical nutrients and unknowns, convert same verified units only',()=>{
 const food={...foodCatalog[0],carbs_g:null};const input=validateMeal({meal_at:record.measured_at,meal_type:'lunch',memo:null,items:[{food_id:food.id,amount_value:50,amount_unit:'g'}]});
 const saved=materializeMeal(input,randomUUID(),DEMO_USERS.a.id,[food]);assert.equal(saved.items[0].nutrition_snapshot!.nutrients.carbs_g,null);assert.equal(itemNutrients(saved.items[0])!.carbs_g,null);
 const edit={...input,items:[{...input.items[0],id:saved.items[0].id,amount_value:25}]};const updated=materializeMeal(edit,saved.id,DEMO_USERS.a.id,[{...food,kcal:999}],saved);assert.equal(updated.items[0].nutrition_snapshot!.nutrients.kcal,food.kcal);
 assert.equal(itemNutrients({...saved.items[0],amount_unit:'개'}),null);
});
test('policy matching keeps partial age overlaps and missing facts as needs-review',()=>{
 const base:UserPreferences={user_id:DEMO_USERS.a.id,region:null,age_band:'19_39',diagnosed:null,insulin_use:null,matching_enabled:true,notice_version:'matching-v1',consented_at:record.measured_at,updated_at:record.measured_at};
 const rule:BenefitRule={...benefitRules[0],region_scope:['all'],criteria_json:{schema_version:1,min_age:30,additional_requirements:[]}};
 assert.equal(matchBenefit(rule,base).state,'needs_review');assert.equal(matchBenefit(rule,{...base,age_band:'40_64'}).state,'match');assert.equal(matchBenefit(rule,{...base,age_band:'under_19'}).state,'no_match');
 assert.equal(matchBenefit({...rule,criteria_json:{schema_version:1,diagnosed:true,additional_requirements:[]}},base).state,'needs_review');
});
test('demo persists atomic meals, preferences and imports, isolates owners and recovers identical requests',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'glucose-features-'));
 try{
  const filename=path.join(dir,'data.json'),store=new DemoStore(filename);await store.agree(DEMO_USERS.a.id);
  const context:RequestContext={session:{user:DEMO_USERS.a,mode:'demo',consent:'current'},store};
  const saved=await saveMeal(context,{id:randomUUID(),meal_at:record.measured_at,meal_type:'lunch',memo:'시연',items:[]});
  await assert.rejects(store.getMeal(DEMO_USERS.b.id,saved.id),(error:unknown)=>error instanceof ApiError&&error.status===404);
  await store.savePreferences(DEMO_USERS.a.id,{region:'서울',age_band:'40_64',diagnosed:true,insulin_use:null,matching_enabled:true,notice_version:'matching-v1'});
  assert.equal(await store.getPreferences(DEMO_USERS.b.id),null);
  const requestId=randomUUID(),csv='value,time,context\n110,2026-10-21T12:00,공복',body={request_id:requestId,csv,mapping:{glucose_mg_dl:0,measured_at:1,measurement_context:2}};
  const [first,second]=await Promise.all([importCsv(context,body),importCsv(context,body)]);assert.equal(first.batch.id,second.batch.id);assert.deepEqual([first.duplicate,second.duplicate],[false,true]);
  const aliasId=randomUUID();await importCsv(context,{...body,request_id:aliasId});assert.equal((await store.getImport(DEMO_USERS.a.id,aliasId)).id,first.batch.id);
  const multiple='value,time,context\n130,2026-10-21T12:00,공복\n140,2026-10-21T14:00,공복';
  const importedMultiple=await importCsv(context,{...body,request_id:randomUUID(),csv:multiple});
  const reversed=await importCsv(context,{...body,request_id:randomUUID(),csv:multiple.split('\n').slice(0,1).concat(multiple.split('\n').slice(1).reverse()).join('\n')});assert.equal(reversed.duplicate,true);assert.equal(reversed.batch.id,importedMultiple.batch.id);
  const reopened=new DemoStore(filename);assert.equal((await reopened.getMeal(DEMO_USERS.a.id,saved.id)).memo,'시연');assert.equal((await reopened.getImport(DEMO_USERS.a.id,requestId)).row_count,1);
  await assert.rejects(importCsv(context,{...body,csv:csv.replace('110','111')}),(error:unknown)=>error instanceof ApiError&&error.code==='IMPORT_CONFLICT');
  const file=await readFile(filename,'utf8');assert.equal(file.includes('value,time,context'),false);assert.equal(file.includes('filename'),false);
  assert.equal((await searchFoods(context,'없는음식검색')).foods.length,0);
  const emptyNews=await listNews(context,{fetch:async()=>new Response('<rss><channel><title>가상 건강 소식</title></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}})});
  assert.equal(emptyNews.configured,true);assert.deepEqual(emptyNews.articles,[]);
  const edited=await store.saveMeal(DEMO_USERS.a.id,saved.id,{meal_at:saved.meal_at,meal_type:'lunch',memo:'바꿈',items:[]},[],saved.updated_at);
  await assert.rejects(store.saveMeal(DEMO_USERS.a.id,saved.id,{meal_at:saved.meal_at,meal_type:'lunch',memo:'오래된 값',items:[]},[],saved.updated_at),(error:unknown)=>error instanceof ApiError&&error.code==='STALE_RECORD');
  assert.equal((await reopened.getMeal(DEMO_USERS.a.id,saved.id)).memo,edited.memo);
  const withNew=await store.saveMeal(DEMO_USERS.a.id,saved.id,{meal_at:saved.meal_at,meal_type:'lunch',memo:null,items:[{id:randomUUID(),free_text:'새 음식',amount_value:1.2345,amount_unit:'g'}]},[],edited.updated_at);assert.equal(withNew.items.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
