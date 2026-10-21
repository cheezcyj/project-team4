import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {localFoodCatalog} from '../../src/lib/server/food-catalog';
import {ApiError} from '../../src/lib/server/errors';
// The importer is a dependency-free Node CLI module, exercised with synthetic source rows.
import {FOOD_HEADERS,normalizeFoodFile,catalogSql} from '../../scripts/lib/food-catalog-import.mjs';

const source=()=>Buffer.from('\uFEFF'+FOOD_HEADERS.join(',')+'\nA001,검사 음식,음식,120,100ml,2.2,,25.73,0,,1.0,250ml,검사기관\nA002,"쉼표, 음식",음식,50,100g,1,0,0,0,0,0,150g,검사기관\n');
test('local food importer preserves declared source basis, null vs zero and deterministic identities',()=>{
 const raw=source();const catalog=normalizeFoodFile(raw,{now:'2026-10-21T00:00:00.000Z'});
 assert.equal(catalog.records_count,2);assert.equal(catalog.source_sha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(catalog.records[0].basis_unit,'ml');assert.equal(catalog.records[0].source_weight,'250ml');assert.equal(catalog.records[0].unit_validated,false);assert.equal(catalog.records[0].fat_g,null);assert.equal(catalog.records[1].fat_g,0);assert.equal(catalog.missing.fiber_g,1);
 assert.equal(normalizeFoodFile(raw).records[0].id,catalog.records[0].id);
 assert.match(catalogSql(catalog),/on conflict \(id\) do nothing/);assert.equal(catalogSql(catalog).includes('auth.users'),false);
});
test('food importer rejects wrong headers, duplicate source codes and invalid nutrient numbers',()=>{
 assert.throws(()=>normalizeFoodFile(Buffer.from('a,b\n1,2')));
 assert.throws(()=>normalizeFoodFile(Buffer.from(source().toString().replace('A002','A001'))));
 assert.throws(()=>normalizeFoodFile(Buffer.from(source().toString().replace('120,100ml','-1,100ml'))));
 assert.throws(()=>normalizeFoodFile(Buffer.from([0xff,0xfe,0x00])));
});
test('local catalog verifies stored record digest; corruption is preserved and never hidden by fallback',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'food-import-')),filename=path.join(dir,'catalog.json');
 const previous=process.env.FOOD_CATALOG_FILE;
 process.env.FOOD_CATALOG_FILE=filename;
 try{
  assert.equal((await localFoodCatalog()).source,'built_in');
  const artifact=normalizeFoodFile(source());await writeFile(filename,JSON.stringify(artifact));
  assert.equal((await localFoodCatalog()).foods.length,2);
  artifact.records[0].kcal=999;const corrupted=JSON.stringify(artifact);await writeFile(filename,corrupted);
  await assert.rejects(localFoodCatalog(),(error:unknown)=>error instanceof ApiError&&error.code==='FOOD_CATALOG_UNAVAILABLE');assert.equal(await readFile(filename,'utf8'),corrupted);
 }finally{if(previous===undefined)delete process.env.FOOD_CATALOG_FILE;else process.env.FOOD_CATALOG_FILE=previous;await rm(dir,{recursive:true,force:true});}
});
