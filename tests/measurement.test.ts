import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {measurement} from '../cloud/measurement.ts';
import {initialMetricPolicy,validateMetricPolicy,summarizeMetric,importedMetric} from '../lib/measurement/model.ts';
import type {Env,Statement} from '../cloud/types.ts';
import type {Fact} from '../lib/analytics/model.ts';
import type {Identity} from '../lib/access.ts';
const now=new Date('2026-10-06T05:00:00Z');
const point=(date='2026-10-05',value:number|null=0,definition='one')=>({date,value,definition,collectedAt:'2026-10-06T00:00:00Z'});
test('計測済み0、未取得、欠測、古い記録、混在を区別する',()=>{
 assert.equal(summarizeMetric([point()], '2026-10-05','2026-10-05','test',now).value,0);
 assert.equal(summarizeMetric([], '2026-10-05','2026-10-05','test',now).status,'missing');
 const partial=summarizeMetric([point('2026-10-05',4)],'2026-10-04','2026-10-05','test',now);assert.equal(partial.value,null);assert.equal(partial.recordedValue,4);assert.equal(partial.status,'partial');
 assert.equal(summarizeMetric([point('2026-10-04',null),point()], '2026-10-04','2026-10-05','test',now).status,'partial');
 assert.equal(summarizeMetric([point('2026-10-04',2,'other'),point()], '2026-10-04','2026-10-05','test',now).status,'mixed');
 assert.equal(summarizeMetric([{...point(),collectedAt:'2026-10-01'}],'2026-10-05','2026-10-05','test',now).status,'stale');
 assert.equal(summarizeMetric([point(),point()], '2026-10-05','2026-10-05','test',now).status,'mixed');
});
test('異なる出典を混ぜず、明示した出典だけを採用する',()=>{
 const row=(source:string,value:number)=>({date:'2026-10-05',source,funnelId:'f',definition:'same',collectedAt:'2026-10-06',values:{revenue:value}} as Fact);
 const rows=[row('external',5),row('utage',7)];
 assert.equal(importedMetric(rows,'revenue',{kind:'import',source:'',funnelId:''},'2026-10-05','2026-10-05',now).status,'mixed');
 assert.equal(importedMetric(rows,'revenue',{kind:'import',source:'external',funnelId:''},'2026-10-05','2026-10-05',now).value,5);
});
test('媒体帰属売上を確定売上の取得元に指定できない',()=>{
 const p=structuredClone(initialMetricPolicy);p.metrics.revenue={kind:'ads',connectionIds:['a']};assert.throws(()=>validateMetricPolicy(p));
 p.metrics.revenue={kind:'import',source:'',funnelId:''};p.metrics.payments={kind:'utage',connectionId:'u',funnelId:'f',pageId:'f:p'};assert.throws(()=>validateMetricPolicy(p));
 assert.deepEqual(validateMetricPolicy(initialMetricPolicy),initialMetricPolicy);
});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO businesses(id,name,created_at) VALUES('other','other','2026-10-06')");
 class Q implements Statement{args:unknown[]=[];sql:string;constructor(sql:string){this.sql=sql;}bind(...args:unknown[]){this.args=args;return this;}async first<T>(){return(db.prepare(this.sql).get(...this.args as [])??null) as T|null;}async all<T>(){return{results:db.prepare(this.sql).all(...this.args as []) as T[]};}async run(){return{meta:{changes:Number(db.prepare(this.sql).run(...this.args as []).changes)}};}}
 const env={DB:{prepare:(s:string)=>new Q(s),batch:async(ss:Statement[])=>{db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}} as Env;
 const user:Identity={id:'owner',companyId:'company',name:'owner',email:'owner@example.test',role:'owner',version:0,grants:[]};
 const get=(scope='default',actor=user)=>measurement(new Request('https://test?start=2026-10-05&end=2026-10-05'),env,actor,scope);
 const save=(policy:unknown,scope='default',actor=user,id='save-1',version=0)=>measurement(new Request('https://test',{method:'POST',body:JSON.stringify({policy,requestId:id,expectedVersion:version})}),env,actor,scope);
 return{db,env,user,get,save};
}
test('事業ごとの設定保存、再送、競合、非管理者の設定変更拒否',async()=>{
 const f=fixture();try{const p=structuredClone(initialMetricPolicy);p.metrics.revenue={kind:'import',source:'forms',funnelId:''};
 assert.equal((await f.save(p)).status,200);assert.equal((await f.save(p)).status,200);assert.equal((await f.get()).status,200);
 assert.equal((await(await f.get()).json()).policy.version,1);assert.equal((await(await f.get('other')).json()).policy.version,0);
 assert.equal((await f.save(p,'default',f.user,'different')).status,409);
 const member={...f.user,role:'member',grants:[{businessId:'default',page:'analytics',edit:true,projects:null}]} as Identity;
 assert.equal((await f.save(p,'default',member)).status,403);assert.equal((await f.get('default',{...member,grants:[]})).status,403);
 }finally{f.db.close();}
});
test('別事業の広告接続、外貨、日本以外の時間帯は正式な円建て費用にできない',async()=>{
 const f=fixture();try{f.db.prepare("INSERT INTO ad_reporting_connections(id,business_id,provider,external_id,name,currency,timezone,credential,created_at) VALUES('a','other','meta','act_1','test','JPY','Asia/Tokyo','secret','2026-10-06')").run();
 const p=structuredClone(initialMetricPolicy);p.metrics.cost={kind:'ads',connectionIds:['a']};assert.equal((await f.save(p)).status,400);
 f.db.exec("UPDATE ad_reporting_connections SET business_id='default',currency='USD'");assert.equal((await f.save(p)).status,400);
 f.db.exec("UPDATE ad_reporting_connections SET currency='JPY',timezone='UTC'");assert.equal((await f.save(p)).status,400);
 f.db.exec("UPDATE ad_reporting_connections SET timezone='Asia/Tokyo'");assert.equal((await f.save(p)).status,200);
 f.db.prepare("INSERT INTO ad_reporting_days VALUES('a','2026-10-05','[]','2026-10-06')").run();
 const result=await(await f.get()).json();assert.equal(result.metrics.cost.value,0);assert.equal(result.metrics.cost.points,undefined);assert.ok(!JSON.stringify(result).includes('secret'));
 f.db.exec("INSERT INTO ad_reporting_connections(id,business_id,provider,external_id,name,currency,timezone,credential,created_at) VALUES('b','default','meta','act_2','second','JPY','Asia/Tokyo','secret','2026-10-06')");
 p.version=1;p.metrics.cost={kind:'ads',connectionIds:['a','b']};assert.equal((await f.save(p,'default',f.user,'multi-ads',1)).status,200);
 assert.equal((await(await f.get()).json()).metrics.cost.status,'partial');assert.equal((await(await f.get()).json()).metrics.cost.value,null);
 f.db.prepare("INSERT INTO ad_reporting_days VALUES('b','2026-10-05',?,'2026-10-06')").run(JSON.stringify([{spend:50}]));assert.equal((await(await f.get()).json()).metrics.cost.value,50);
 const details=await(await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&detail=cost'),f.env,f.user,'default')).json();assert.equal(details.metrics.cost.points.length,1);assert.equal(details.metrics.cost.points[0].value,50);assert.equal(details.metrics.revenue.points,undefined);assert.ok(!JSON.stringify(details).includes('secret'));
 const limited={...f.user,role:'member',grants:[{businessId:'default',page:'analytics',edit:false,projects:['project']},{businessId:'default',page:'ads',edit:false,projects:null}]} as Identity;
 const denied=await(await f.get('default',limited)).json();assert.equal(denied.metrics.cost.status,'restricted');assert.equal(denied.policy,null);assert.equal(denied.choices,null);const restricted=await(await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&detail=cost'),f.env,limited,'default')).json();assert.equal(restricted.metrics.cost.points,undefined);assert.equal(restricted.metrics.cost.status,'restricted');assert.equal((await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&detail=credential'),f.env,f.user,'default')).status,400);
 }finally{f.db.close();}
});
test('UTAGEページを特定し、同じファネルの別ページを二重に合算しない',async()=>{
 const f=fixture();try{
 f.db.prepare("INSERT INTO native_connections(id,business_id,provider,label,external_id,credential,targets,created_at) VALUES('u','default','utage','test','workspace','secret',?,'2026-10-06')").run(JSON.stringify([{id:'f',name:'funnel'}]));
 const pages=[{id:'f:p',funnelId:'f',name:'entry',daily:[{date:'2026-10-05',registrations:2,sales:1,revenue:100}]},{id:'f:q',funnelId:'f',name:'thanks',daily:[{date:'2026-10-05',registrations:2,sales:1,revenue:100}]}];
 f.db.prepare("INSERT INTO native_snapshots VALUES('default','u','pages:f','2026-10-05',?,'2026-10-06')").run(JSON.stringify(pages));
 const p=structuredClone(initialMetricPolicy);p.metrics.registrations={kind:'utage',connectionId:'u',funnelId:'f',pageId:'f:p'};
 assert.equal((await f.save(p)).status,200);const result=await(await f.get()).json();assert.equal(result.metrics.registrations.value,2);assert.equal(result.choices.utage.length,2);assert.ok(!JSON.stringify(result).includes('secret'));
 const detail=await(await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&detail=registrations'),f.env,f.user,'default')).json();assert.equal(detail.metrics.registrations.points.length,1);assert.equal(detail.metrics.registrations.points[0].value,2);assert.equal(detail.metrics.revenue.points,undefined);assert.ok(!JSON.stringify(detail).includes('secret'));
 p.metrics.registrations.pageId='f:missing';assert.equal((await f.save({...p,version:1},'default',f.user,'unknown-page',1)).status,400);
 assert.equal((await f.save({...p,version:0},'other',f.user,'other-page')).status,400);
 f.db.exec("UPDATE native_connections SET enabled=0,last_error='offline'");const stopped=await(await f.get()).json();assert.equal(stopped.metrics.registrations.recordedValue,2);assert.equal(stopped.metrics.registrations.error,'offline');assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_snapshots').get()!.n,1);
 }finally{f.db.close();}
});

test('正式指標の明細も期間と出典を絞り、欠測を0にしない',()=>{
 const row=(date:string,source:string,value:number|null)=>({date,source,funnelId:'f',definition:'same',collectedAt:'2026-10-06',values:{revenue:value}} as Fact);
 const result=importedMetric([row('2026-10-05','selected',7),row('2026-10-05','other',100),row('2026-09-01','selected',200),row('2026-10-04','selected',null)],'revenue',{kind:'import',source:'selected',funnelId:'f'},'2026-10-04','2026-10-05',now,true);
 assert.equal(result.value,null);assert.equal(result.recordedValue,7);assert.equal(result.points?.length,2);assert.deepEqual(result.points?.map(p=>p.value),[7,null]);
});


test('dashboard chart points preserve existing permission and business boundaries',async()=>{
 const f=fixture();try{
 const response=await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&charts=1'),f.env,f.user,'default');const data=await response.json();assert.equal(response.status,200);assert.deepEqual(data.metrics.cost.points,[]);assert.deepEqual(data.metrics.revenue.points,[]);
 const denied=await measurement(new Request('https://test?start=2026-10-05&end=2026-10-05&charts=1'),f.env,{...f.user,role:'member',grants:[]},'default');assert.equal(denied.status,403);
 }finally{f.db.close();}
});
