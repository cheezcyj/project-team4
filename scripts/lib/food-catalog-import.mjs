import {createHash} from 'node:crypto';

export const FOOD_HEADERS=['식품코드','식품명','데이터구분명','에너지(kcal)','영양성분함량기준량','단백질(g)','지방(g)','탄수화물(g)','당류(g)','식이섬유(g)','나트륨(mg)','식품중량','제공기관명'];
const hash=value=>createHash('sha256').update(value).digest('hex');
function rowsFromCsv(text){
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let index=0;index<text.length;index++){
  const character=text[index];
  if(quoted){if(character==='"'){if(text[index+1]==='"'){field+='"';index++;}else{quoted=false;closed=true;}}else field+=character;continue;}
  if(character==='"'){if(field||closed)throw new Error('잘못된 CSV 따옴표');quoted=true;continue;}
  if(character===','||character==='\r'||character==='\n'){
   row.push(field);field='';closed=false;
   if(character!==','){if(character==='\r'&&text[index+1]==='\n')index++;rows.push(row);row=[];}
  }else{if(closed)throw new Error('닫는 따옴표 뒤의 잘못된 문자');field+=character;}
 }
 if(quoted)throw new Error('닫히지 않은 CSV 따옴표');if(field||row.length||closed){row.push(field);rows.push(row);}return rows;
}
function stableId(source,version,code){const bytes=createHash('sha256').update(JSON.stringify([source,version,code])).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;const value=bytes.toString('hex');return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;}
export function normalizeFoodFile(buffer,{sourceVersion,now=new Date().toISOString()}={}){
 if(buffer.length>100*1024*1024)throw new Error('원본 용량은 100MiB까지 지원해요.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
 const table=rowsFromCsv(text);const headers=table.shift();
 if(JSON.stringify(headers)!==JSON.stringify(FOOD_HEADERS))throw new Error('원본의 13개 열 이름과 순서가 예상과 달라요.');
 if(!table.length||table.length>100000)throw new Error('원본 데이터 행 수를 확인해 주세요.');
 const sourceSha256=hash(buffer),version=sourceVersion??`provided-${sourceSha256.slice(0,16)}`;
 if(typeof version!=='string'||!version.trim()||version.length>80)throw new Error('출처 버전을 1~80자로 지정해 주세요.');
 const seen=new Set(),missing={kcal:0,carbs_g:0,sugars_g:0,protein_g:0,fat_g:0,fiber_g:0,sodium_mg:0},units={g:0,ml:0};
 const records=table.map((row,index)=>{
  if(row.length!==13)throw new Error(`${index+1}행의 열 개수가 달라요.`);
  const [code,name,type,energy,basis,protein,fat,carbs,sugars,fiber,sodium,weight,source]=row.map(value=>value.trim());
  if(!code||!name||!type||!source||code.length>100||[...name].length>200||[...source].length>200)throw new Error(`${index+1}행의 필수 정보가 잘못됐어요.`);
  const match=/^(\d+(?:\.\d{1,4})?)\s*(g|ml)$/.exec(basis);
  if(!match||Number(match[1])<=0)throw new Error(`${index+1}행의 기준량을 확인해 주세요.`);
  function nutrient(value,key){if(value===''){missing[key]++;return null;}if(!/^\d+(?:\.\d{1,4})?$/.test(value)||Number(value)>=100000000)throw new Error(`${index+1}행의 ${key} 숫자를 확인해 주세요.`);return Number(value);}
  const id=stableId(source,version,code);if(seen.has(id))throw new Error(`${index+1}행의 출처와 코드가 중복돼요.`);seen.add(id);units[match[2]]++;
  return {id,food_name:name,source_code:code,basis_value:Number(match[1]),basis_unit:match[2],kcal:nutrient(energy,'kcal'),carbs_g:nutrient(carbs,'carbs_g'),sugars_g:nutrient(sugars,'sugars_g'),protein_g:nutrient(protein,'protein_g'),fat_g:nutrient(fat,'fat_g'),fiber_g:nutrient(fiber,'fiber_g'),sodium_mg:nutrient(sodium,'sodium_mg'),source,source_url:null,source_version:version,source_sha256:sourceSha256,source_type:type,source_weight:weight||null,unit_validated:false,status:'approved',checked_at:now};
 });
 return {schema_version:1,source_sha256:sourceSha256,source_version:version,imported_at:now,records_count:records.length,records_sha256:hash(JSON.stringify(records)),approval_scope:'local_preview',units,missing,records};
}
export function catalogSql(artifact){
 const columns=Object.keys(artifact.records[0]);
 const literal=value=>value===null?'NULL':typeof value==='number'||typeof value==='boolean'?String(value):`'${String(value).replaceAll("'","''")}'`;
 const chunks=[];
 for(let offset=0;offset<artifact.records.length;offset+=500)chunks.push(`insert into public.food_catalog (${columns.join(',')}) values\n${artifact.records.slice(offset,offset+500).map(row=>`(${columns.map(column=>literal(row[column])).join(',')})`).join(',\n')} on conflict (id) do nothing;`);
 return `-- Local source artifact. Review source permissions and deployment destination before applying.\n-- source_sha256: ${artifact.source_sha256}\n-- records_sha256: ${artifact.records_sha256}\nbegin;\n${chunks.join('\n')}\ncommit;\n`;
}
