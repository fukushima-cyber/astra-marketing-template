import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {login,passwordHash,sameOrigin} from '../cloud/auth.ts';
import {digest} from '../cloud/storage.ts';
import {randomToken,newSession} from '../cloud/identity.ts';
import type {Env} from '../cloud/types.ts';
import worker from '../cloud/worker.ts';
function setup(){
 const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const statement=(sql:string)=>{let args:unknown[]=[];return {bind(...a:unknown[]){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args as any[])??null;},async all(){return {results:sqlite.prepare(sql).all(...args as any[])};},async run(){const x=sqlite.prepare(sql).run(...args as any[]);return {meta:{changes:Number(x.changes)}};}};};
 const env={SESSION_SECRET:'private-test-secret-never-use-in-production',ADMIN_PASSWORD:'legacy-pass',DB:{prepare:statement,async batch(statements:any[]){sqlite.exec('BEGIN');try{const results=[];for(const st of statements)results.push(await st.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},ASSETS:{async fetch(){return new Response('static shell');}}} as Env;
 let ip=1;
 const req=(path:string,token='',body?:unknown)=>new Request('https://example.com'+path,{method:body===undefined?'GET':'POST',headers:{cookie:token,origin:'https://example.com','cf-connecting-ip':'192.0.2.'+(ip++),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const form=(path:string,values:Record<string,string>)=>new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://example.com','cf-connecting-ip':'192.0.2.'+(ip++),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
 async function invite(role='owner',email:string|null=null){const token=randomToken();sqlite.prepare('INSERT INTO invitations(token_hash,company_id,email,role,expires,created_at) VALUES(?,?,?,?,?,?)').run(await digest(token),'company',email,role,Date.now()+600000,new Date().toISOString());return token;}
 async function enroll(role='owner',email=role+'@example.com'){const token=await invite(role,role==='owner'?null:email),r=await worker.fetch(form('/join',{token,email,name:role,password:'test-password-1234',confirmation:'test-password-1234'}),env);assert.equal(r.status,303,await r.clone().text());return {cookie:r.headers.get('set-cookie')!.split(';')[0],token,id:sqlite.prepare('SELECT id FROM users WHERE email=?').get(email)!.id as string};}
 return {env,sqlite,req,form,invite,enroll};
}
test('ログイン前・旧共通Cookie・別サイトからの更新を拒否',async()=>{
 const s=setup();for(const cookie of ['', '__Host-astra=old-signed-token'])assert.equal((await worker.fetch(s.req('/api/marketing/business',cookie),s.env)).status,401);
 assert.equal((await worker.fetch(s.req('/owner'),s.env)).status,303);
 assert.equal(sameOrigin(new Request('https://example.com',{headers:{origin:'https://evil.test'}})),false);
 assert.equal(sameOrigin(new Request('https://example.com')),false);
 const r=await worker.fetch(new Request('https://example.com/login',{method:'POST',body:'password=legacy-pass'}),s.env);assert.equal(r.status,403);
});
test('本人用の一度だけ使える登録・メールと個別パスワード・ログアウト',async()=>{
 const s=setup(),owner=await s.enroll();assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie),s.env)).status,200);
 const replay=await worker.fetch(s.form('/join',{token:owner.token,email:'other@example.com',name:'other',password:'test-password-1234',confirmation:'test-password-1234'}),s.env);assert.equal(replay.status,400);
 const another=await s.invite('owner');assert.equal((await worker.fetch(s.form('/join',{token:another,email:'second@example.com',name:'second',password:'test-password-1234',confirmation:'test-password-1234'}),s.env)).status,409);
 assert.equal((await worker.fetch(s.form('/login',{email:'owner@example.com',password:'wrong'}),s.env)).status,401);
 const logged=await worker.fetch(s.form('/login',{email:'owner@example.com',password:'test-password-1234'}),s.env);assert.equal(logged.status,303);
 assert.equal((await worker.fetch(s.req('/logout',owner.cookie,{}),s.env)).status,303);
 assert.equal((await worker.fetch(s.req('/api/me',owner.cookie),s.env)).status,401);
});
test('招待先メールの照合・取消・期限切れを拒否',async()=>{
 const s=setup(),token=await s.invite('member','invited@example.com');
 const form=(email:string)=>s.form('/join',{token,email,name:'member',password:'test-password-1234',confirmation:'test-password-1234'});
 assert.equal((await worker.fetch(form('wrong@example.com'),s.env)).status,400);
 s.sqlite.prepare('UPDATE invitations SET revoked=1').run();assert.equal((await worker.fetch(form('invited@example.com'),s.env)).status,400);
 s.sqlite.prepare('UPDATE invitations SET revoked=0,expires=0').run();assert.equal((await worker.fetch(form('invited@example.com'),s.env)).status,400);
});
test('人別の画面・編集・事業・案件制限をAPIと会社集計へ強制',async()=>{
 const s=setup(),owner=await s.enroll(),member=await s.enroll('member');
 s.sqlite.prepare("INSERT INTO businesses(id,name,created_at) VALUES('secret','機密事業','2026-09-10')").run();
 s.sqlite.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) VALUES(?,'default','analytics',0,'[\"public-project\"]')").run(member.id);
 const data={version:1,name:'機密事業目標',objective:'機密の全体方針',goals:[{id:'secret-goal'}],observations:[{revenue:9999}],campaigns:[],projects:[{id:'public-project',name:'許可案件'},{id:'secret-project',name:'機密案件'}],funnels:[{id:'f1',projectId:'public-project',name:'許可導線'},{id:'f2',projectId:'secret-project',name:'機密導線'}]};
 s.sqlite.prepare("INSERT INTO documents(id,version,data,last_request) VALUES('business',1,?,'')").run(JSON.stringify(data));
 s.sqlite.prepare("INSERT INTO analytics_imports(id,signature,created_at,count,business_id) VALUES('fixture','','',2,'default')").run();
 for(const [id,project,revenue] of [['001','public-project',100],['002','secret-project',900]])s.sqlite.prepare("INSERT INTO analytics_rows(id,source,external_id,project_id,date,data,import_id,business_id) VALUES(?,'test',?,?,'2026-09-10',?,'fixture','default')").run(id,id,project,JSON.stringify({id,projectId:project,values:{revenue,payments:revenue},definition:'same'}));
 const list=await (await worker.fetch(s.req('/api/marketing/businesses',member.cookie),s.env)).json() as any;assert.deepEqual(list.businesses.map((b:any)=>b.id),['default']);
 const all=await worker.fetch(s.req('/api/marketing/business',member.cookie),s.env);const text=await all.text();assert.ok(text.includes('許可案件'));assert.ok(!text.includes('機密'));assert.ok(!text.includes('9999'));
 const analytics=await (await worker.fetch(s.req('/api/marketing/analytics?businessId=default',member.cookie),s.env)).json() as any;assert.deepEqual(analytics.rows.map((r:any)=>r.id),['001']);assert.equal(analytics.nextCursor,null);
 const metrics=await (await worker.fetch(s.req('/api/company?start=2026-09-01&end=2026-09-10',member.cookie),s.env)).json() as any;assert.equal(metrics.businesses[0].metrics.revenue,100);assert.deepEqual(metrics.businesses[0].goals,[]);assert.equal(metrics.businesses.length,1);
 for(const path of ['/api/owner','/owner','/owner.html','/api/marketing/connections','/api/marketing/postiz?action=drafts','/api/marketing/live'])assert.equal((await worker.fetch(s.req(path,member.cookie),s.env)).status,403,path);
 assert.equal((await worker.fetch(s.req('/api/marketing/analytics?businessId=secret',member.cookie),s.env)).status,404);
 for(const path of ['/api/marketing/businesses','/api/marketing/business','/api/marketing/analytics','/api/marketing/connected'])assert.equal((await worker.fetch(s.req(path,member.cookie,{}),s.env)).status,403,path);
 const ownerRows=await (await worker.fetch(s.req('/api/marketing/analytics',owner.cookie),s.env)).json() as any;assert.equal(ownerRows.rows.length,2);
});
test('権限更新・停止で既存セッションを失効し、競合更新で権限を壊さない',async()=>{
 const s=setup(),owner=await s.enroll(),m=await s.enroll('member');
 const body={action:'member',id:m.id,version:1,active:true,grants:[{businessId:'default',page:'posts',edit:false,projects:null}]};
 assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie,body),s.env)).status,200);
 assert.equal((await worker.fetch(s.req('/api/me',m.cookie),s.env)).status,401);
 assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie,{...body,grants:[]}),s.env)).status,409);
 assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM access_grants WHERE user_id=?').get(m.id)!.n,1);
 const fresh=(await newSession(s.env,m.id)).split(';')[0];assert.equal((await worker.fetch(s.req('/api/marketing/postiz?action=drafts',fresh),s.env)).status,200);
 assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie,{...body,version:2,active:false,grants:[]}),s.env)).status,200);
 assert.equal((await worker.fetch(s.req('/api/me',fresh),s.env)).status,401);
 assert.equal((await worker.fetch(s.form('/login',{email:'member@example.com',password:'test-password-1234'}),s.env)).status,401);
 assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie,{...body,id:owner.id}),s.env)).status,403);
 assert.throws(()=>s.sqlite.prepare('DELETE FROM users WHERE id=?').run(owner.id));
 assert.throws(()=>s.sqlite.prepare('UPDATE users SET active=0 WHERE id=?').run(owner.id));
});
test('管理者による招待に権限が保存され、再設定リンクは一度だけ使える',async()=>{
 const s=setup(),owner=await s.enroll();const response=await worker.fetch(s.req('/api/owner',owner.cookie,{action:'invite',email:'new@example.com',grants:[{businessId:'default',page:'posts',edit:true,projects:null}]}),s.env);assert.equal(response.status,200);const b=await response.json() as any;const token=new URLSearchParams(new URL(b.url).hash.slice(1)).get('token')!;
 const joined=await worker.fetch(s.form('/join',{token,email:'new@example.com',name:'new',password:'test-password-1234',confirmation:'test-password-1234'}),s.env);assert.equal(joined.status,303);const cookie=joined.headers.get('set-cookie')!.split(';')[0];const me=await (await worker.fetch(s.req('/api/me',cookie),s.env)).json() as any;assert.equal(me.user.grants[0].edit,true);assert.equal(me.user.role,'member');
 const reset=await (await worker.fetch(s.req('/api/owner',owner.cookie,{action:'reset',email:'new@example.com'}),s.env)).json() as any;const resetToken=new URLSearchParams(new URL(reset.url).hash.slice(1)).get('token')!;
 const form=()=>s.form('/join',{token:resetToken,email:'new@example.com',name:'new',password:'changed-password-1234',confirmation:'changed-password-1234'});
 assert.equal((await worker.fetch(form(),s.env)).status,303);assert.equal((await worker.fetch(form(),s.env)).status,400);assert.equal((await worker.fetch(s.req('/api/me',cookie),s.env)).status,401);
});

test('会社グラフの日別集計は期間・案件・事業権限を守り、未取得と0を区別する',async()=>{
 const s=setup(),owner=await s.enroll(),member=await s.enroll('member');
 s.sqlite.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) VALUES(?,'default','analytics',0,'[\"allowed\"]')").run(member.id);
 s.sqlite.prepare("INSERT INTO businesses(id,name,created_at) VALUES('hidden','非公開事業','2026-09-01')").run();
 s.sqlite.prepare("INSERT INTO analytics_imports(id,signature,created_at,count,business_id) VALUES('chart-fixture','','',7,'default')").run();
 const fixtures=[
  ['a','allowed','2026-09-01',{revenue:100,sales:0,registrations:2},'default'],
  ['b','allowed','2026-09-01',{payments:40},'default'],
  ['c','allowed','2026-09-03',{revenue:0,sales:2},'default'],
  ['d','allowed','2026-09-04',{refunds:10},'default'],
  ['e','denied','2026-09-01',{revenue:9000},'default'],
  ['f','allowed','2026-08-31',{revenue:8000},'default'],
  ['g','allowed','2026-09-01',{revenue:7000},'hidden'],
 ] as const;
 for(const [id,project,date,values,business] of fixtures)s.sqlite.prepare("INSERT INTO analytics_rows(id,source,external_id,project_id,date,data,import_id,business_id) VALUES(?,'test',?,?,?,?, 'chart-fixture',?)").run(id,id,project,date,JSON.stringify({values,definition:'fixture'}),business);
 const get=async(cookie:string)=>(await (await worker.fetch(s.req('/api/company?start=2026-09-01&end=2026-09-04',cookie),s.env)).json()) as any;
 const result=await get(member.cookie),business=result.businesses[0];
 assert.equal(result.businesses.length,1);
 assert.deepEqual(business.daily.map((d:any)=>[d.date,d.revenue,d.revenueCount,d.records]),[['2026-09-01',100,1,2],['2026-09-03',0,1,1],['2026-09-04',null,0,1]]);
 assert.equal(business.metrics.revenue,100);assert.equal(business.metrics.revenueCount,2);
 assert.equal(business.daily[0].sales,0);assert.equal(business.daily[0].salesCount,1);assert.equal(business.daily[0].registrationsCount,1);
 assert.equal(business.daily[0].refunds,null);assert.equal(business.metrics.payments,40);
 const all=await get(owner.cookie);assert.equal(all.businesses.length,2);assert.equal(all.businesses.find((b:any)=>b.id==='default').metrics.revenue,9100);
 s.sqlite.prepare("UPDATE access_grants SET page='posts',projects='null' WHERE user_id=?").run(member.id);
 const denied=await get(member.cookie);assert.equal(denied.businesses[0].metrics,null);assert.equal(denied.businesses[0].daily,null);
 const empty=await (await worker.fetch(s.req('/api/company?start=2027-01-01&end=2027-01-02',owner.cookie),s.env)).json() as any;
 assert.deepEqual(empty.businesses[0].daily,[]);assert.equal(empty.businesses[0].metrics.revenue,null);
});
