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
 for(const f of ['0001_initial.sql','0002_analytics.sql','0003_businesses_native.sql','0004_company_identity.sql','0008_business_kind.sql','0010_business_archiving.sql','0013_business_strategy.sql'])db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
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
test('Instagramのプロアカウントからフォロワーとインサイトを取得し、未取得を0にしない',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;const metrics:string[]=[];
 globalThis.fetch=async input=>{const url=new URL(String(input));assert.equal(url.hostname,'graph.instagram.com');
  if(url.pathname.endsWith('/me'))return Response.json({user_id:'ig-123',username:'astra_test',followers_count:321,media_count:18});
  const metric=url.searchParams.get('metric')??'';metrics.push(metric);assert.equal(url.searchParams.get('metric_type'),'total_value');assert.equal(url.searchParams.get('period'),'day');
  if(metric==='profile_views')return Response.json({error:{message:'not available'}},{status:400});
  const value=({views:'120',reach:80,total_interactions:15,accounts_engaged:10} as Record<string,string|number>)[metric];
  return metric==='reach'?Response.json({data:[{name:metric,values:[{value}]}]}):Response.json({data:[{name:metric,total_value:{value}}]});
 };
 try{
  const created=await connections(post({action:'create',provider:'instagram',label:'Instagram公式',token:'ig-token'}),env,'default');assert.equal(created.status,200);const {id}=await created.json();
  assert.equal((await connections(post({action:'collect',id}),env,'default')).status,200);assert.deepEqual(metrics.sort(),['accounts_engaged','profile_views','reach','total_interactions','views']);
  const stored=JSON.parse(db.prepare("SELECT data FROM native_snapshots WHERE connection_id=? AND resource_id='account'").get(id)!.data as string);assert.equal(stored.handle,'astra_test');assert.equal(stored.followers,321);assert.equal(stored.mediaCount,18);assert.equal(stored.impressions,120);assert.equal(stored.reach,80);assert.equal(stored.profileViews,null);assert.equal(stored.interactions,15);assert.equal(stored.engagedAccounts,10);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),catalog=await(await connected(new Request(`https://test?action=catalog&start=${today}&end=${today}`),env,'default')).json();assert.equal(catalog.accounts[0].platform,'instagram');assert.equal(catalog.accounts[0].series[0].profileViews,null);assert.ok(!JSON.stringify(catalog).includes('ig-token'));
 }finally{globalThis.fetch=original;db.close();}
});
test('認証済みAPIでも他事業の下書きは読めず、同じ再送IDが競合しない',async()=>{
 const {db,env}=fixture();try{db.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('test-owner','company','test@example.com','test','','owner','2026-09-10')").run();const cookie=(await newSession(env,'test-owner')).split(';')[0];
 const request=(scope:string,body?:unknown)=>worker.fetch(new Request('https://test/api/marketing/postiz?action=drafts',{method:body?'POST':'GET',headers:{cookie,origin:'https://test','X-Astra-Business':scope},...(body?{body:JSON.stringify(body)}:{})}),env);
 for(const id of ['business','second:business'])db.prepare("INSERT INTO documents(id,version,data,last_request) VALUES(?,1,?,'')").run(id,JSON.stringify({goals:[{id:'goal'}]}));
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

test('新規SNS下書きの同一再送は同じ保存IDと版を返し、サンプル目標を拒否',async()=>{
 const {db,env}=fixture();try{
 db.exec("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('retry-owner','company','retry@example.test','test','','owner','2026-09-10')");
 db.prepare("INSERT INTO documents VALUES('business',1,?,'')").run(JSON.stringify({goals:[{id:'real-goal'}]}));
 const cookie=(await newSession(env,'retry-owner')).split(';')[0];
 const save=(b:unknown)=>worker.fetch(new Request('https://test/api/marketing/postiz',{method:'POST',headers:{cookie,origin:'https://test'},body:JSON.stringify(b)}),env);
 const b={action:'save',requestId:'replay-id',draftId:'temporary-client-id',expectedVersion:0,draft:{title:'投稿',content:'本文',goalId:'real-goal',platform:'x',assetIds:[]}};
 const first=await(await save(b)).json(),again=await(await save(b)).json();assert.equal(first.draft.id,again.draft.id);assert.equal(again.draft.version,1);
 assert.equal(JSON.parse(String(db.prepare("SELECT data FROM documents WHERE id='drafts'").get()!.data)).length,1);
 assert.equal((await save({...b,requestId:'invalid-goal',draft:{...b.draft,goalId:'demo-conversions'}})).status,400);
 }finally{db.close();}
});
test('UTAGEの複数対象取得が途中失敗しても、明細と前回成功を全て保持',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;try{
 const credential=await seal(env,'default','utage-atomic','utage-old');
 db.prepare("INSERT INTO native_connections(id,business_id,provider,label,external_id,credential,targets,created_at,last_success) VALUES('utage-atomic','default','utage','test','workspace',?,?,?,'previous-success')").run(credential,JSON.stringify([{id:'f1',name:'one'},{id:'f2',name:'two'}]),'2026-09-01');
 db.prepare("INSERT INTO native_snapshots VALUES('default','utage-atomic','f1','2026-09-01',?,'old-time')").run('{"pv":7}');
 const before=db.prepare('SELECT * FROM native_snapshots').all();
 globalThis.fetch=async input=>String(input).includes('/f2/')?Response.json({error:'test'},{status:500}):Response.json({data:[{step_name:'step',pages:[{page_id:'p',page_name:'page',totals:{pv:99},daily:[{date:new Date(Date.now()-86400000).toISOString().slice(0,10),pv:99}]}]}]});
 const c=db.prepare("SELECT * FROM native_connections").get() as unknown as Connection;
 await assert.rejects(collect(env,c));assert.deepEqual(db.prepare('SELECT * FROM native_snapshots').all(),before);
 assert.equal(db.prepare('SELECT last_success FROM native_connections').get()!.last_success,'previous-success');
 }finally{globalThis.fetch=original;db.close();}
});
test('UTAGE別キーは既存履歴へ差替えず、同じキーの再登録を認識',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;globalThis.fetch=async()=>Response.json({data:[{id:'f1',name:'one'}]});try{
 const created=await(await connections(post({action:'create',provider:'utage',label:'one',token:'old-key'}),env,'default')).json();
 const row=db.prepare('SELECT credential FROM native_connections').get()!.credential;
 assert.equal((await connections(post({action:'replace',id:created.id,token:'another-key'}),env,'default')).status,400);
 assert.equal(db.prepare('SELECT credential FROM native_connections').get()!.credential,row);
 assert.equal((await connections(post({action:'create',provider:'utage',label:'duplicate',token:'old-key'}),env,'default')).status,409);
 assert.equal((await connections(post({action:'create',provider:'utage',label:'separate',token:'another-key'}),env,'default')).status,200);
 }finally{globalThis.fetch=original;db.close();}
});
test('UTAGEページ詳細を保存し、API停止時も前回の値を欠測表示付きで返す',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;try{
 const key=await seal(env,'default','cache','cache-key');db.prepare("INSERT INTO native_connections(id,business_id,provider,label,external_id,credential,targets,created_at) VALUES('cache','default','utage','test','workspace',?,?,'2026-09-01')").run(key,JSON.stringify([{id:'f1',name:'one'}]));
 const request=()=>connected(new Request('https://test?action=utage&groupId=cache:f1&start=2026-09-01&end=2026-09-01'),env,'default');
 globalThis.fetch=async()=>Response.json({data:[{step_name:'page',pages:[{page_id:'p',page_name:'one',has_payment_element:true,totals:{pv:9,sale_amount:500},daily:[{date:'2026-09-01',pv:9,sale_amount:500,sale_count:1}]}]}]});
 assert.equal((await request()).status,200);
 const rows=db.prepare('SELECT * FROM native_snapshots').all();assert.equal(rows.length,1);
 globalThis.fetch=async()=>{throw new Error('offline');};const saved=await(await request()).json();assert.equal(saved.cached,true);assert.equal(saved.pages[0].totals.revenue,500);assert.equal(saved.pages[0].totals.uu,null);assert.equal(saved.failures.length,1);assert.deepEqual(db.prepare('SELECT * FROM native_snapshots').all(),rows);
 }finally{globalThis.fetch=original;db.close();}
});

test('同じ事業に同じSNS媒体の別アカウントを保存し、履歴を接続別に維持する',async()=>{
 const {db,env}=fixture(),original=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{const token=new Headers(init?.headers).get('Authorization');return Response.json({data:{id:token==='Bearer first-token'?'account1':'account2',username:token==='Bearer first-token'?'first':'second',public_metrics:{followers_count:token==='Bearer first-token'?10:20}}});};
 try{
  for(const token of ['first-token','second-token'])assert.equal((await connections(post({action:'create',provider:'x',label:token,token}),env,'default')).status,200);
  assert.equal((await connections(post({action:'create',provider:'x',label:'重複',token:'first-token'}),env,'default')).status,409);
  const rows=db.prepare('SELECT * FROM native_connections').all() as unknown as Connection[];for(const row of rows)await collect(env,row);
  assert.equal(db.prepare('SELECT count(*) AS n FROM native_snapshots').get()!.n,2);
  const catalog=await(await connected(new Request('https://test?action=catalog'),env,'default')).json();assert.equal(catalog.accounts.length,2);
 }finally{globalThis.fetch=original;db.close();}
});
