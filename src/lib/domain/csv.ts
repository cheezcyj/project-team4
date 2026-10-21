import { contexts, type RecordInput } from './types';
import { mealSlots } from './service-types';
import { isTimestamp,seoulInputToIso } from './dates';
import { validateRecord } from './records';
export const CSV_MAX_BYTES=2*1024*1024;
export const CSV_MAX_ROWS=1000;
export type CsvMapping={glucose_mg_dl:number;measured_at:number;measurement_context:number;meal_slot?:number;meal_memo?:number;unit?:number};
export type CsvRowError={row:number;message:string};
export function parseCsv(text:string):{headers:string[];rows:string[][]} {
  if(new TextEncoder().encode(text).length>CSV_MAX_BYTES) throw new Error('CSV 파일은 2MiB까지 가져올 수 있어요.');
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text) || text.includes('\ufffd')) throw new Error('UTF-8 CSV 파일로 저장하고 표시할 수 없는 문자를 지워 주세요.');
  text=text.replace(/^\uFEFF/,'');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){ if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else {quoted=false;closed=true;}}else field+=c;continue; }
    if(c==='"'){if(field || closed)throw new Error('따옴표 위치를 확인해 주세요.');quoted=true;continue;}
    if(c===',' || c==='\n' || c==='\r'){
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];if(rows.length>CSV_MAX_ROWS+1)throw new Error('데이터는 1000행까지 가져올 수 있어요.');}
      continue;
    }
    if(closed)throw new Error('닫는 따옴표 뒤에는 쉼표나 줄바꿈만 넣어 주세요.');field+=c;
  }
  if(quoted)throw new Error('닫히지 않은 따옴표가 있어요.');
  if(field || row.length || closed){row.push(field);rows.push(row);}
  if(rows.length<2 || rows.length>CSV_MAX_ROWS+1)throw new Error('머리글과 1~1000개 데이터 행이 필요해요.');
  const headers=rows.shift()!;
  if(headers.some(header=>!header.trim()))throw new Error('비어 있는 열 이름을 채워 주세요.');
  const wrongWidth=rows.findIndex(row=>row.length!==headers.length);
  if(wrongWidth>=0)throw new Error(`${wrongWidth+1}행의 열 개수가 머리글과 달라요.`);
  return {headers,rows};
}
export function validateCsvRows(rows:string[][],mapping:CsvMapping):{records:RecordInput[];errors:CsvRowError[]} {
  const records:RecordInput[]=[],errors:CsvRowError[]=[];
  const indexes=Object.values(mapping).filter(value=>value!==undefined);
  if(['glucose_mg_dl','measured_at','measurement_context'].some(key=>!Number.isInteger(mapping[key as keyof CsvMapping])) || indexes.some(index=>!Number.isInteger(index)||index<0) || new Set(indexes).size!==indexes.length) return {records,errors:[{row:0,message:'필수 열을 겹치지 않게 연결해 주세요.'}]};
  if(rows.length<1 || rows.length>CSV_MAX_ROWS)return {records,errors:[{row:0,message:'데이터는 1~1000행이어야 해요.'}]};
  rows.forEach((row,index)=>{
    if(indexes.some(column=>column>=row.length)){errors.push({row:index+1,message:'연결한 열의 값이 없어요.'});return;}
    const read=(key:keyof CsvMapping)=>mapping[key]===undefined?undefined:row[mapping[key]!];
    const rawTime=(read('measured_at')??'').trim();
    const localTime=seoulInputToIso(rawTime.replace(' ','T'));
    const measured_at=isTimestamp(rawTime)?rawTime:localTime;
    const rawContext=(read('measurement_context')??'').trim();
    const measurement_context=contexts.find(item=>item.value===rawContext||item.label===rawContext)?.value??rawContext;
    const rawSlot=read('meal_slot')?.trim();
    const meal_slot=rawSlot?mealSlots.find(item=>item.value===rawSlot||item.label===rawSlot)?.value??rawSlot:null;
    const unit=read('unit')?.trim();
    if(unit!==undefined && unit!=='mg/dL'){errors.push({row:index+1,message:'혈당 단위는 mg/dL이어야 해요.'});return;}
    const result=validateRecord({glucose_mg_dl:read('glucose_mg_dl')?.trim(),measured_at,measurement_context,meal_slot,meal_memo:read('meal_memo')});
    if(!result.ok)errors.push({row:index+1,message:Object.values(result.fields).join(' ')}); else records.push(result.value);
  });
  return {records:errors.length?[]:records,errors};
}
