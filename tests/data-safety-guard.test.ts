import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('配置前チェックがDB変更・既存マイグレーション変更・未検証の追加を拒否',()=>{
 const dir=mkdtempSync(join(tmpdir(),'astra-data-guard-'));try{
 for(const d of ['scripts','docs','migrations','supabase','supabase/migrations'])mkdirSync(join(dir,d));
 const files=['scripts/check-data-safety.mjs','docs/data-safety-manifest.json','wrangler.jsonc',...readdirSync(new URL('../migrations/',import.meta.url)).map(f=>'migrations/'+f),...readdirSync(new URL('../supabase/migrations/',import.meta.url)).map(f=>'supabase/migrations/'+f)];
 for(const f of files)copyFileSync(new URL('../'+f,import.meta.url),join(dir,f));
 const run=()=>spawnSync(process.execPath,[join(dir,'scripts/check-data-safety.mjs')],{encoding:'utf8'}).status;
 assert.equal(run(),0);const original=readFileSync(join(dir,'wrangler.jsonc'),'utf8'),config=JSON.parse(original);if(config.vars?.DB_PROVIDER==='supabase')config.hyperdrive[0].id='replacement';else config.d1_databases[0].database_id='replacement';writeFileSync(join(dir,'wrangler.jsonc'),JSON.stringify(config));assert.notEqual(run(),0);
 writeFileSync(join(dir,'wrangler.jsonc'),original);if(config.vars?.DB_PROVIDER==='supabase'){const file=join(dir,'supabase/migrations/'+readdirSync(join(dir,'supabase/migrations'))[0]),saved=readFileSync(file);writeFileSync(file,'SELECT 1;');assert.notEqual(run(),0);writeFileSync(file,saved);}
 const migration=join(dir,'migrations/0001_initial.sql'),sql=readFileSync(migration);writeFileSync(migration,'DROP TABLE documents;');assert.notEqual(run(),0);writeFileSync(migration,sql);writeFileSync(join(dir,'migrations/9999_unreviewed.sql'),'SELECT 1;');assert.notEqual(run(),0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

