import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {seal,connections,collect,type Connection} from '../cloud/native.ts';
import {connected} from '../cloud/connected.ts';
import {documentId,resolveBusiness,businesses} from '../cloud/business-scope.ts';
import {newSession} from '../cloud/identity.ts';
import worker from '../cloud/worker.ts';
import type {Env,Statement} from '../cloud/types.ts';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_initial.sql','0002_analytics.sql','0003_businesses_native.sql','0004_company_identity.sql'])db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.exec("INSERT INTO businesses(id,name,created_at) VALUES('second','別事業','2026-09-10')");
 class Q implements Statement{sql:string;args:unknown[]=[];constructor(sql:string){this.sql=sql;}bind(...args:unknown[]){this.args=args;return this;}async first<T>(){return(db.prepare(this.sql).get(...this.args as [])??null) as T|null;}async all<T>(){return{results:db.prepare(this.sql).all(...this.args as []) as T[]};}async run(){return{meta:{changes:Number(db.prepare(this.sql).run(...this.args as []).changes)}};}}
 const env={DB:{prepare:(s:string)=>new Q(s),batch:async(ss:Statement[])=>{db.exec('BEGIN');try{const rows=[];for(const s of ss)rows.push(await s.run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}},CONNECTOR_KEY:btoa('01234567890123456789012345678901'),SESSION_SECRET:'session-test',ADMIN_PASSWORD:'test',ASSETS:{fetch:async()=>new Response('asset')}} as Env;
 return{db,env};
}
const post=(b:unknown)=>new Request('https://test/api',{method:'POST',body:JSON.stringify(b)});
test('暗号化したキーは別事業や別接続では復号できない',async()=>{
 const {db,env}=fixture();try{const encrypted=await seal(env,'default','one','private-token');assert.ok(!encrypted.includes('private-token'));assert.equal(await seal(env,'default','one',encrypted,true),'private-token');await assert.rejects(seal(env,'second','one',encrypted,true));await assert.rejects(seal(env,'default','two',encrypted,true));}finally{db.close();}
});
test('事業一覧、事業選択、存在しない事業、既存文書の保存先',async()=>{
 const {db,env}=fixture();try{assert.equal(documentId('default','business'),'business');assert.equal(documentId('second','business'),'second:business');assert.equal((await resolveBusiness(new Request('https://test',{headers:{'X-Astra-Business':'second'}}),env))?.name,'別事業');assert.equal(await resolveBusiness(new Request('https://test?businessId=missing'),env),null);
 const r=await businesses(new Request('https://test'),env);assert.equal((await r.json()).businesses.find((b:any)=>b.id==='default').name,'最初の事業');
 assert.equal((await businesses(post({action:'create',id:'third',name:'追加事業'}),env)).status,200);
 }finally{db.close();}
});
test('トラッカーを呼ばず、ネイティブ接続は事業ごとに分離。日次取得の再実行は上書き一件',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;const called:string[]=[];
 globalThis.fetch=async(input)=>{const url=String(input);called.push(url);assert.equal(new URL(url).hostname,'api.x.com');return Response.json({data:{id:'123',username:'test-account',public_metrics:{followers_count:25}}});};
 try{
 const created=await connections(post({action:'create',provider:'x',label:'自社SNS',token:'test-secret'}),env,'default');assert.equal(created.status,200);const {id}=await created.json();
 const list=await(await connections(new Request('https://test'),env,'default')).json();assert.equal(list.connections.length,1);assert.ok(!JSON.stringify(list).includes('credential'));assert.ok(!JSON.stringify(list).includes('test-secret'));
 assert.equal((await(await connections(new Request('https://test'),env,'second')).json()).connections.length,0);
 assert.equal((await connections(post({action:'collect',id}),env,'second')).status,404);
 const c=db.prepare('SELECT * FROM native_connections WHERE id=?').get(id) as unknown as Connection;
 await collect(env,c);await collect(env,c);assert.equal(db.prepare('SELECT count(*) AS n FROM native_snapshots').get()!.n,1);
 const count=called.length;
 const cat=await(await connected(new Request('https://test?action=catalog'),env,'default')).json();assert.equal(cat.accounts.length,1);assert.equal(called.length,count);
 assert.equal((await(await connected(new Request('https://test?action=catalog'),env,'second')).json()).accounts.length,0);
 assert.equal((await connected(new Request('https://test?action=utage&start=2026-02-30&end=2026-09-10'),env,'default')).status,400);
 }finally{globalThis.fetch=original;db.close();}
});
test('認証済みAPIでも他事業の下書きは読めず、同じ再送IDが競合しない',async()=>{
 const {db,env}=fixture();try{db.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('test-owner','company','test@example.com','test','','owner','2026-09-10')").run();const cookie=(await newSession(env,'test-owner')).split(';')[0];
 const request=(scope:string,body?:unknown)=>worker.fetch(new Request('https://test/api/marketing/postiz?action=drafts',{method:body?'POST':'GET',headers:{cookie,origin:'https://test','X-Astra-Business':scope},...(body?{body:JSON.stringify(body)}:{})}),env);
 const b={action:'save',requestId:'same',draft:{title:'投稿',content:'本文',goalId:'goal',platform:'x',assetIds:[]}};
 assert.equal((await request('default',b)).status,200);assert.equal((await(await request('second')).json()).drafts.length,0);
 assert.equal((await request('second',{...b,draft:{...b.draft,content:'別事業の本文'}})).status,200);
 assert.equal((await(await request('default')).json()).drafts[0].content,'本文');assert.equal((await(await request('second')).json()).drafts[0].content,'別事業の本文');assert.equal((await request('missing',b)).status,404);
 }finally{db.close();}
});
test('事業分離への移行は既存の実績と取込履歴を保持する',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('PRAGMA foreign_keys=ON');for(const f of ['0001_initial.sql','0002_analytics.sql'])db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.exec("INSERT INTO analytics_imports VALUES('old','sig','2026-09-01',1); INSERT INTO analytics_rows VALUES('row','src','external','project','2026-09-01','{\"original\":true}','old')");
 db.exec(readFileSync(new URL('../migrations/0003_businesses_native.sql',import.meta.url),'utf8'));
 const row=db.prepare('SELECT * FROM analytics_rows').get()!;assert.equal(row.business_id,'default');assert.equal(row.data,'{"original":true}');assert.equal(db.prepare('SELECT business_id FROM analytics_imports').get()!.business_id,'default');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
test('UTAGEは登録したファネルだけを直接取得し、別事業からは取得できない',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async input=>{const url=new URL(String(input));urls.push(url.href);assert.equal(url.hostname,'api.utage-system.com');if(url.pathname==='/v1/funnels')return Response.json({data:[{id:'f1',name:'販売'}],meta:{total:1}});assert.equal(url.pathname,'/v1/funnels/f1/stats/daily');assert.equal(url.searchParams.get('aggregation_method'),'accrual_date');return Response.json({data:[{step_name:'入口',pages:[{page_id:'p1',page_name:'商品',has_payment_element:true,totals:{pv:20,uu:8,registration_count:2,sale_amount:1000},daily:[{date:'2026-09-01',pv:20,uu:8,registration_count:2,sale_amount:1000}]}]}]});};
 try{const {id}=await(await connections(post({action:'create',provider:'utage',label:'販売',token:'test-key'}),env,'default')).json();assert.ok(id);
 assert.equal((await connections(post({action:'targets',id,ids:['unknown']}),env,'default')).status,400);
 assert.equal((await connections(post({action:'targets',id,ids:['f1']}),env,'default')).status,200);
 const request=()=>new Request(`https://test?action=utage&groupId=${id}:f1&start=2026-09-01&end=2026-09-02`);
 const size=urls.length;assert.equal((await connected(request(),env,'second')).status,404);assert.equal(urls.length,size);
 const r=await connected(request(),env,'default');assert.equal(r.status,200);const b=await r.json();assert.equal(b.pages[0].totals.uu,8);assert.equal(b.pages[0].totals.revenue,1000);assert.ok(!JSON.stringify(b).includes('test-key'));
 }finally{globalThis.fetch=original;db.close();}
});
