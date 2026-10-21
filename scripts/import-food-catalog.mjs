import {readFile,mkdir,writeFile,rename,copyFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeFoodFile,catalogSql} from './lib/food-catalog-import.mjs';

const args=process.argv.slice(2);
const allowed=new Set(['--input','--source-version','--apply','--prepare-sql']);
const values={};
for(let index=0;index<args.length;index++){
 const key=args[index];if(!allowed.has(key))throw new Error('지원하지 않는 실행 인자예요.');
 if(key==='--apply'||key==='--prepare-sql')values[key]=true;
 else{const value=args[++index];if(!value||value.startsWith('--'))throw new Error('입력 경로 또는 버전 값이 필요해요.');values[key]=value;}
}
if(!values['--input']){console.log('Usage: node scripts/import-food-catalog.mjs --input <UTF-8 CSV> [--source-version <version>] [--apply] [--prepare-sql]');process.exit(0);}
const artifact=normalizeFoodFile(await readFile(path.resolve(values['--input'])),{sourceVersion:values['--source-version']});
const bytes=Buffer.from(JSON.stringify(artifact)),artifactSha=createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({mode:values['--apply']?'local-apply':'dry-run',rows:artifact.records_count,columns:13,source_sha256:artifact.source_sha256,source_version:artifact.source_version,artifact_sha256:artifactSha,records_sha256:artifact.records_sha256,units:artifact.units,missing:artifact.missing,unit_validated:false,remote_database_changes:false},null,2));
const directory=path.resolve('.local');
async function atomic(filename,content){
 if(path.dirname(filename)!==directory)throw new Error('출력은 로컬 전용 폴더여야 해요.');
 await mkdir(directory,{recursive:true});const temporary=`${filename}.${randomUUID()}.tmp`;
 try{await writeFile(temporary,content,{mode:0o600});
  try{await copyFile(filename,`${filename}.previous-${Date.now()}`);}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(temporary,filename);
  const stored=await readFile(filename);if(createHash('sha256').update(stored).digest('hex')!==createHash('sha256').update(content).digest('hex'))throw new Error('저장 뒤 확인값이 달라요.');
 }finally{await unlink(temporary).catch(()=>undefined);}
}
if(values['--apply']){
 await atomic(path.join(directory,'food-catalog.json'),bytes);
 await atomic(path.join(directory,'food-catalog.integrity.json'),Buffer.from(JSON.stringify({source_sha256:artifact.source_sha256,artifact_sha256:artifactSha,records_sha256:artifact.records_sha256,rows:artifact.records_count,verified_at:new Date().toISOString()},null,2)));
 console.log('PASS: local catalog saved and SHA-256 readback verified.');
}
if(values['--prepare-sql']){await atomic(path.join(directory,'food-catalog.import.sql'),Buffer.from(catalogSql(artifact)));console.log('Prepared local SQL artifact only. No database connection was opened.');}
