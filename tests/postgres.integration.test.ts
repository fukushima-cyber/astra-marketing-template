import {commerce} from '../cloud/commerce.ts';
import {measurement} from '../cloud/measurement.ts';
import {initialMetricPolicy} from '../lib/measurement/model.ts';
import type {Identity} from '../lib/access.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {PostgresDatabase} from '../cloud/postgres.ts';
import {postgresSql} from '../cloud/postgres-sql.ts';
import {commitDocument,readDocument,Conflict} from '../cloud/storage.ts';
import {newSession,currentUser} from '../cloud/identity.ts';
import {tableFingerprint} from '../cloud/database-migration.ts';
import type {Env} from '../cloud/types.ts';
const connection=process.env.TEST_POSTGRES_URL;
test('PostgreSQL migration: real queries, authorization, concurrency and rollback',{skip:!connection},async t=>{
 const url=new URL(connection!);assert.ok(url.searchParams.get('host')==='/private/tmp/astra-pg-socket-20261006'||process.env.CI==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/astra_migration_test','Integration fixtures require an isolated local database');
 const admin=new Client({connectionString:connection});await admin.connect();await admin.query('TRUNCATE '+(await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='astra'")).rows.map(r=>'astra.'+r.tablename).join(',')+' CASCADE');
 const db=new PostgresDatabase(connection!,true);
 try{
  await t.test('all static application SQL plans against PostgreSQL',async()=>{
   let checked=0;for(const file of readdirSync(new URL('../cloud/',import.meta.url)).filter(f=>f.endsWith('.ts')&&!f.startsWith('postgres'))){const source=ts.createSourceFile(file,readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);const queries:string[]=[];function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='prepare'&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))queries.push(node.arguments[0].text);ts.forEachChild(node,visit);}visit(source);for(const sql of queries){const q=postgresSql(sql);try{await admin.query('EXPLAIN '+q.sql,Array(q.parameters).fill(null));}catch(e){throw new Error(file+': '+sql+'\n'+String(e));}checked++;}}assert.ok(checked>100,'Expected the full static SQL corpus');
  });
  await db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').bind('company','test company').run();await db.prepare('INSERT INTO businesses(id,name,created_at) VALUES(?,?,?)').bind('test','test business','2026-10-06').run();
  await db.prepare('INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)').bind('owner','company','Owner@Example.com','owner','test-hash','owner','2026-10-06').run();
  await t.test('case-insensitive email, millisecond session, user field casing and owner protection',async()=>{
   assert.equal((await db.prepare('SELECT id FROM users WHERE email=?').bind('owner@example.com').first<{id:string}>())?.id,'owner');
   const env={DB:db} as Env,cookie=await newSession(env,'owner');const user=await currentUser(new Request('https://example.com',{headers:{cookie:cookie.split(';')[0]}}),env);assert.equal(user?.companyId,'company');assert.equal(user?.role,'owner');
   await assert.rejects(db.prepare('DELETE FROM users WHERE id=?').bind('owner').run(),/owner cannot be removed/);
  });
  await t.test('JSON extraction, numeric aggregation, JSON update and null project permissions',async()=>{
   const grants=JSON.stringify([{businessId:'test',page:'analytics',edit:true,projects:null}]);await db.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) SELECT ?,json_extract(value,'$.businessId'),json_extract(value,'$.page'),json_extract(value,'$.edit'),COALESCE(json_extract(value,'$.projects'),'null') FROM json_each(?)").bind('owner',grants).run();assert.deepEqual((await db.prepare('SELECT edit,projects FROM access_grants').all()).results,[{edit:1,projects:'null'}]);
   const row=await db.prepare("SELECT SUM(json_extract(value,'$.values.revenue')) AS revenue,COUNT(json_extract(value,'$.values.revenue')) AS revenueCount FROM json_each(?)").bind(JSON.stringify([{values:{revenue:12.5}},{values:{revenue:0}},{values:{}}])).first();assert.deepEqual(row,{revenue:12.5,revenueCount:2});
   const updated=await db.prepare("SELECT json_set(?,'$.syncMissing',json('true'),'$.funnelId',?) AS data").bind('{"syncMissing":false,"funnelId":"old"}','new').first<{data:string}>();assert.deepEqual(JSON.parse(updated!.data),{syncMissing:true,funnelId:'new'});
   const attempts='INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts';await db.prepare(attempts).bind('ip',123).first();assert.equal((await db.prepare(attempts).bind('ip',123).first<{attempts:number}>())?.attempts,2);
  });
  await t.test('batch failure rolls back every statement and replay/stale versions remain safe',async()=>{
   await assert.rejects(db.batch([db.prepare('INSERT INTO documents VALUES(?,?,?,?)').bind('rollback',0,'{}',''),db.prepare('INSERT INTO documents VALUES(?,?,?,?)').bind('rollback',0,'{}','')]));assert.equal(await db.prepare('SELECT * FROM documents WHERE id=?').bind('rollback').first(),null);
   await commitDocument(db,'safe',0,{value:1},'r1','sig');await commitDocument(db,'safe',0,{value:1},'r1','sig');await assert.rejects(commitDocument(db,'safe',0,{value:2},'r2','sig2'),Conflict);assert.equal((await readDocument(db,'safe',{})).version,1);
   const other=new PostgresDatabase(connection!,true);try{const results=await Promise.allSettled([commitDocument(db,'safe',1,{value:2},'a','a'),commitDocument(other,'safe',1,{value:3},'b','b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readDocument(db,'safe',{})).version,2);}finally{await other.close();}
  });
  await t.test('queued queries freeze their bound parameters',async()=>{
   const statement=db.prepare('INSERT INTO documents(id,version,data,last_request) VALUES(?,?,?,?)');await Promise.all([statement.bind('frozen-a',0,'{}','').run(),statement.bind('frozen-b',0,'{}','').run()]);const batch=db.batch([statement.bind('frozen-c',0,'{}','')]);statement.bind('frozen-d',0,'{}','');await batch;assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM documents WHERE id IN ('frozen-a','frozen-b','frozen-c')").first<{count:number}>())?.count,3);
  });
  await t.test('read-only snapshot is consistent and cannot write',async()=>{
   const snapshot=await db.batch([db.prepare('SELECT id FROM companies'),db.prepare('SELECT id FROM users')],true) as {results:unknown[]}[];assert.equal(snapshot[0].results.length,1);assert.equal(snapshot[1].results.length,1);await assert.rejects(db.batch([db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').bind('forbidden','forbidden')],true),/read-only/);assert.equal(await db.prepare('SELECT id FROM companies WHERE id=?').bind('forbidden').first(),null);
  });
  await t.test('metric policy saves and reads through the real PostgreSQL adapter',async()=>{
   const actor:Identity={id:'owner',companyId:'company',name:'owner',email:'owner@example.test',role:'owner',version:0,grants:[]};
   const env={DB:db} as Env;
   const body=JSON.stringify({policy:initialMetricPolicy,expectedVersion:0,requestId:'pg-metric-policy'});
   const save=()=>measurement(new Request('https://test',{method:'POST',body}),env,actor,'test');
   assert.equal((await save()).status,200);assert.equal((await save()).status,200);
   const result=await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05'),env,actor,'test');assert.equal(result.status,200);
   const payload=await result.json();assert.equal(payload.policy.version,1);assert.equal(payload.metrics.revenue.status,'missing');assert.equal(payload.choices.ads.length,0);
  });
  await t.test('sales ledger persists revisions, payment and refund with replay and conflict protection',async()=>{
   const actor:Identity={id:'owner',companyId:'company',name:'owner',email:'owner@example.test',role:'owner',version:0,grants:[]},env={DB:db} as Env;
   const post=(body:unknown)=>commerce(new Request('https://test',{method:'POST',body:JSON.stringify(body)}),env,actor,'test');
   const product={id:'course',name:'教材',model:'content',price:1000,archived:false};
   assert.equal((await post({action:'save_product',product,expectedVersion:0,requestId:'p1'})).status,200);
   const entry={id:'sale-1',productId:'course',date:'2026-10-06',quantity:1,amount:1000,fee:20,payment:'pending',kind:'sale',originalId:'',reference:'order-1',notes:''};
   const sale={action:'record_sale',entry,expectedVersion:1,requestId:'s1'};
   assert.equal((await post(sale)).status,200);assert.equal((await post(sale)).status,200);
   assert.equal((await post({...sale,requestId:'stale'})).status,409);
   const r=await commerce(new Request('https://test?start=2026-10-01&end=2026-10-31'),env,actor,'test'),body=await r.json();assert.equal(body.data.entries.length,1);assert.equal(body.totals.net,980);
   const revisions=await db.prepare("SELECT count(*) AS n FROM document_revisions WHERE document_id=?").bind('test:commerce').first<{n:number}>();assert.ok((revisions?.n??0)>=2);
  });
  await t.test('anonymous access is denied and server role can use its RLS policy',async()=>{
   await admin.query('SET ROLE anon');await assert.rejects(admin.query('SELECT * FROM astra.users'),/permission denied/);await admin.query('RESET ROLE');await admin.query('SET ROLE astra_runtime');assert.equal((await admin.query('SELECT id FROM astra.users')).rows.length,1);await assert.rejects(admin.query('DELETE FROM astra.journey_events'),/permission denied/);await assert.rejects(admin.query('UPDATE astra.document_revisions SET data=\'null\''),/permission denied/);await admin.query('RESET ROLE');
   assert.equal(await tableFingerprint([{b:' exact JSON ',a:1}]),await tableFingerprint([{a:1,b:' exact JSON '}]));assert.notEqual(await tableFingerprint([{a:1}]),await tableFingerprint([{a:2}]));
  });
 }finally{await db.close();await admin.end();}
});
