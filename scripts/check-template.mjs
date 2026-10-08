import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
assert.equal(config.account_id,undefined,'Remove deployment account ID');
assert.equal(config.vars.DB_PROVIDER,'supabase');
assert.equal(config.hyperdrive[0].id,'00000000000000000000000000000000','Remove deployment Hyperdrive ID');
assert.equal(JSON.parse(readFileSync('docs/data-safety-manifest.json','utf8')).supabase.projectId,'YOUR_SUPABASE_PROJECT_ID');
const business=JSON.parse(readFileSync('templates/business.json','utf8'));
for(const key of ['projects','funnels','goals','observations','campaigns'])assert.deepEqual(business[key],[]);
for(const key of ['name','objective','updatedAt'])assert.equal(business[key],'');
assert.equal(readFileSync('templates/analytics.csv','utf8').trim().split(/\r?\n/).length,1,'CSV must contain headers only');
const db=new DatabaseSync(':memory:');
for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(join('migrations',name),'utf8'));
const expected={businesses:1,companies:1};
for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
  const count=db.prepare('SELECT COUNT(*) AS n FROM "'+name+'"').get().n;
  assert.equal(count,expected[name]??0,`Unexpected seeded rows in ${name}`);
}
db.close();
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
  if(['.git','node_modules','.next','out'].includes(e.name))continue;
  const path=join(dir,e.name);
  assert(!/^(\.data|\.wrangler|\.env.*|\.dev\.vars.*|\.DS_Store)$/.test(e.name),`Runtime data in template: ${path}`);
  assert(!/\.(sqlite3?|db|log|pem)$/.test(e.name),`Private or runtime file: ${path}`);
  if(e.isDirectory())scan(path);else if(!path.endsWith('check-template.mjs')){
    const text=readFileSync(path,'utf8');
    assert(!/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@(?!127\.0\.0\.1|localhost)/.test(text),`Embedded database connection: ${path}`);
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(text),`Credential-like content: ${path}`);
  }
}}
scan('.');console.log('Template checks passed: blank formats, clean initial DB, placeholder deployment IDs, no runtime files or recognized credential patterns.');
