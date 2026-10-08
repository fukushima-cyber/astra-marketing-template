import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {googleCallback,googleStart,login,loginPage,passwordHash,sameOrigin,verifyGoogleIdToken} from '../cloud/auth.ts';
import {digest} from '../cloud/storage.ts';
import {randomToken,newSession} from '../cloud/identity.ts';
import type {Env} from '../cloud/types.ts';
import worker from '../cloud/worker.ts';
import {allAccessGrants,pageNames} from '../lib/access.ts';
function setup(){
 const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO businesses(id,name,created_at,company_id,kind,revenue_models) VALUES('affiliate','アフィリエイト','2026-01-01','company','affiliate','[\"affiliate\"]')");
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
 const asset=await worker.fetch(s.req('/_next/static/chunks/test.js'),s.env);assert.equal(asset.status,200);assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable');
 assert.equal(sameOrigin(new Request('https://example.com',{headers:{origin:'https://evil.test'}})),false);
 assert.equal(sameOrigin(new Request('https://example.com')),false);
 const r=await worker.fetch(new Request('https://example.com/login',{method:'POST',body:'password=legacy-pass'}),s.env);assert.equal(r.status,403);
 for(const path of ['/privacy','/terms']){const legal=await worker.fetch(s.req(path),s.env);assert.equal(legal.status,200);assert.match(await legal.text(),/お問い合わせ/);}
});
test('全権限の一括指定は全事業・全機能を重複なく作る',()=>{const grants=allAccessGrants(['default','affiliate','default'],true);assert.equal(grants.length,Object.keys(pageNames).length*2);assert.ok(grants.every(g=>g.edit&&g.projects===null));assert.equal(new Set(grants.map(g=>g.businessId+':'+g.page)).size,grants.length);});
test('本人用の一度だけ使える登録・メールと個別パスワード・ログアウト',async()=>{
 const s=setup(),owner=await s.enroll();assert.equal((await worker.fetch(s.req('/api/owner',owner.cookie),s.env)).status,200);
 const bootstrap=await (await worker.fetch(s.req('/api/me?include=businesses',owner.cookie),s.env)).json() as any;assert.deepEqual(bootstrap.businesses.map((b:any)=>[b.id,b.kind]).sort(),[['affiliate','affiliate'],['default','content']]);
 const created=await (await worker.fetch(s.req('/api/marketing/businesses',owner.cookie,{action:'create',id:'affiliate-case',name:'紹介案件',kind:'affiliate'}),s.env)).json() as any;assert.equal(created.kind,'affiliate');
 const affiliate=await (await worker.fetch(s.req('/api/company?kind=affiliate',owner.cookie),s.env)).json() as any;assert.deepEqual(affiliate.businesses.map((b:any)=>b.id).sort(),['affiliate','affiliate-case']);
 const content=await (await worker.fetch(s.req('/api/company?kind=content',owner.cookie),s.env)).json() as any;assert.deepEqual(content.businesses.map((b:any)=>b.id),['default']);
 assert.equal((await worker.fetch(s.req('/api/company?kind=unknown',owner.cookie),s.env)).status,400);
 const replay=await worker.fetch(s.form('/join',{token:owner.token,email:'other@example.com',name:'other',password:'test-password-1234',confirmation:'test-password-1234'}),s.env);assert.equal(replay.status,400);
 const another=await s.invite('owner');assert.equal((await worker.fetch(s.form('/join',{token:another,email:'second@example.com',name:'second',password:'test-password-1234',confirmation:'test-password-1234'}),s.env)).status,409);
 assert.equal((await worker.fetch(s.form('/login',{email:'owner@example.com',password:'wrong'}),s.env)).status,401);
 const logged=await worker.fetch(s.form('/login',{email:'owner@example.com',password:'test-password-1234'}),s.env);assert.equal(logged.status,303);
 assert.equal((await worker.fetch(s.req('/logout',owner.cookie,{}),s.env)).status,303);
 assert.equal((await worker.fetch(s.req('/api/me',owner.cookie),s.env)).status,401);
});
test('Googleログインは署名・state・nonceを検証し、既存ユーザーへ一度だけ連携する',async()=>{
 const s=setup(),owner=await s.enroll();s.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';s.env.GOOGLE_CLIENT_SECRET='test-client-secret';
 const page=loginPage(s.env),html=await page.text();assert.match(html,/Googleでログイン/);assert.doesNotMatch(html,/type="password"/);
 const automatic=await worker.fetch(s.req('/login'),s.env);assert.equal(automatic.status,303);assert.match(automatic.headers.get('location')??'',/^https:\/\/accounts\.google\.com\//);assert.ok(!new URL(automatic.headers.get('location')!).searchParams.has('prompt'));
 const existing=await worker.fetch(s.req('/login',owner.cookie),s.env);assert.equal(existing.status,303);assert.equal(existing.headers.get('location'),'/company');
 const start=await googleStart(s.req('/auth/google'),s.env);assert.equal(start.status,303);
 const authorization=new URL(start.headers.get('location')!),state=authorization.searchParams.get('state')!,stateCookie=start.headers.get('set-cookie')!.split(';')[0];
 assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('scope'),'openid email profile');
 const saved=s.sqlite.prepare('SELECT nonce FROM oauth_states WHERE state_hash=?').get(await digest(state)) as {nonce:string};
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair;
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
 const unsigned=encode({alg:'RS256',kid:'test-key',typ:'JWT'})+'.'+encode({iss:'https://accounts.google.com',aud:s.env.GOOGLE_CLIENT_ID,sub:'google-owner-1',email:'owner@example.com',email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,nonce:saved.nonce});
 const signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))).toString('base64url'),idToken=unsigned+'.'+signature;
 const googleFetch=async(input:string|URL|Request)=>{
  const url=String(input);if(url.includes('/token'))return Response.json({id_token:idToken});
  if(url.includes('/certs'))return Response.json({keys:[jwk]});throw new Error('unexpected request');
 };
 await assert.rejects(()=>verifyGoogleIdToken(idToken,s.env.GOOGLE_CLIENT_ID!,'wrong-nonce',googleFetch));
 const callback=new Request('https://example.com/auth/google/callback?state='+state+'&code=authorization-code',{headers:{cookie:stateCookie}}),logged=await googleCallback(callback,s.env,googleFetch);
 assert.equal(logged.status,303);assert.equal(logged.headers.get('location'),'/company');assert.match(logged.headers.get('set-cookie')??'',/__Host-astra-user=.*SameSite=Lax/);
 assert.equal(s.sqlite.prepare('SELECT google_sub FROM users WHERE id=?').get(owner.id)!.google_sub,'google-owner-1');
 assert.equal(s.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='account.google_linked'").get()!.n,1);
 const replay=await googleCallback(callback.clone(),s.env,googleFetch);assert.equal(replay.status,400);
});
test('スタッフ招待はGoogle本人確認だけで権限付きアカウントを発行する',async()=>{
 const s=setup(),owner=await s.enroll();
 const invited=await worker.fetch(s.req('/api/owner',owner.cookie,{action:'invite',email:'new@example.com',grants:[{businessId:'default',page:'posts',edit:true,projects:null}]}),s.env);assert.equal(invited.status,200);
 const invitation=await invited.json() as any,token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('token')!;
 s.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';s.env.GOOGLE_CLIENT_SECRET='test-client-secret';
 const page=await worker.fetch(s.req('/join'),s.env),html=await page.text();assert.match(html,/Googleで利用を開始/);assert.doesNotMatch(html,/type="password"/);
 const start=await googleStart(s.req('/auth/google?invite='+token),s.env),authorization=new URL(start.headers.get('location')!),state=authorization.searchParams.get('state')!,stateCookie=start.headers.get('set-cookie')!.split(';')[0];
 const saved=s.sqlite.prepare('SELECT nonce,invite_hash FROM oauth_states WHERE state_hash=?').get(await digest(state)) as {nonce:string;invite_hash:string};assert.equal(saved.invite_hash,await digest(token));
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair;
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');Object.assign(jwk,{kid:'staff-key',alg:'RS256',use:'sig'});
 const unsigned=encode({alg:'RS256',kid:'staff-key',typ:'JWT'})+'.'+encode({iss:'https://accounts.google.com',aud:s.env.GOOGLE_CLIENT_ID,sub:'google-staff-1',email:'new@example.com',email_verified:true,name:'新しい担当者',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,nonce:saved.nonce});
 const idToken=unsigned+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))).toString('base64url');
 const googleFetch=async(input:string|URL|Request)=>{const url=String(input);if(url.includes('/token'))return Response.json({id_token:idToken});if(url.includes('/certs'))return Response.json({keys:[jwk]});throw new Error('unexpected request');};
 const logged=await googleCallback(new Request('https://example.com/auth/google/callback?state='+state+'&code=authorization-code',{headers:{cookie:stateCookie}}),s.env,googleFetch);assert.equal(logged.status,303);assert.equal(logged.headers.get('location'),'/company');
 const user=s.sqlite.prepare('SELECT id,name,password_hash,role,google_sub FROM users WHERE email=?').get('new@example.com') as any;assert.equal(user.name,'新しい担当者');assert.equal(user.password_hash,'!google-login-only!');assert.equal(user.role,'member');assert.equal(user.google_sub,'google-staff-1');
 const grant=s.sqlite.prepare('SELECT page,edit FROM access_grants WHERE user_id=?').get(user.id) as any;assert.equal(grant.page,'posts');assert.equal(grant.edit,1);assert.equal(s.sqlite.prepare('SELECT used_by FROM invitations WHERE token_hash=?').get(await digest(token))!.used_by,user.id);assert.equal(s.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='account.google_enrolled'").get()!.n,1);
});
test('スタッフ招待と違うGoogleメールでは登録しない',async()=>{
 const s=setup(),token=await s.invite('member','invited@example.com');s.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';s.env.GOOGLE_CLIENT_SECRET='test-client-secret';
 const start=await googleStart(s.req('/auth/google?invite='+token),s.env),state=new URL(start.headers.get('location')!).searchParams.get('state')!,stateCookie=start.headers.get('set-cookie')!.split(';')[0],saved=s.sqlite.prepare('SELECT nonce FROM oauth_states WHERE state_hash=?').get(await digest(state)) as {nonce:string};
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair,jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');Object.assign(jwk,{kid:'wrong-key',alg:'RS256',use:'sig'});
 const unsigned=encode({alg:'RS256',kid:'wrong-key',typ:'JWT'})+'.'+encode({iss:'https://accounts.google.com',aud:s.env.GOOGLE_CLIENT_ID,sub:'wrong-google',email:'wrong@example.com',email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,nonce:saved.nonce}),idToken=unsigned+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))).toString('base64url');
 const googleFetch=async(input:string|URL|Request)=>String(input).includes('/token')?Response.json({id_token:idToken}):Response.json({keys:[jwk]});
 const result=await googleCallback(new Request('https://example.com/auth/google/callback?state='+state+'&code=authorization-code',{headers:{cookie:stateCookie}}),s.env,googleFetch);assert.equal(result.status,403);assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM users WHERE email=?').get('wrong@example.com')!.n,0);assert.equal(s.sqlite.prepare('SELECT used_by FROM invitations WHERE token_hash=?').get(await digest(token))!.used_by,null);
});
test('事業はアーカイブ・復元でき、空の追加事業だけを確認後に完全削除できる',async()=>{
 const s=setup(),owner=await s.enroll();
 const send=(body:unknown)=>worker.fetch(s.req('/api/marketing/businesses',owner.cookie,body),s.env);
 assert.equal((await send({action:'create',id:'temporary-content',name:'削除確認用',kind:'content'})).status,200);
 assert.equal((await send({action:'archive',id:'temporary-content'})).status,200);
 const visible=await (await worker.fetch(s.req('/api/me?include=businesses',owner.cookie),s.env)).json() as any;assert.ok(!visible.businesses.some((b:any)=>b.id==='temporary-content'));
 const all=await (await worker.fetch(s.req('/api/marketing/businesses?include=all',owner.cookie),s.env)).json() as any;assert.ok(all.businesses.some((b:any)=>b.id==='temporary-content'&&b.archivedAt));
 assert.equal((await worker.fetch(s.req('/api/marketing/business?businessId=temporary-content',owner.cookie),s.env)).status,404);
 assert.equal((await send({action:'delete',id:'temporary-content',confirmName:'違う名前'})).status,400);
 assert.equal((await send({action:'delete',id:'temporary-content',confirmName:'削除確認用'})).status,200);
 assert.equal((await send({action:'create',id:'restore-content',name:'復元確認用',kind:'content'})).status,200);
 assert.equal((await send({action:'archive',id:'restore-content'})).status,200);
 const restored=await (await send({action:'restore',id:'restore-content'})).json() as any;assert.equal(restored.archivedAt,null);
 assert.equal((await send({action:'delete',id:'restore-content',confirmName:'復元確認用'})).status,409);
 assert.equal((await send({action:'archive',id:'default'})).status,200);
 assert.equal((await send({action:'delete',id:'default',confirmName:'最初の事業'})).status,409);
 assert.equal((await send({action:'restore',id:'default'})).status,200);
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
 const all=await get(owner.cookie);assert.equal(all.businesses.length,3);assert.equal(all.businesses.find((b:any)=>b.id==='default').metrics.revenue,9100);assert.ok(all.businesses.some((b:any)=>b.id==='affiliate'&&b.name==='アフィリエイト'));
 s.sqlite.prepare("UPDATE access_grants SET page='posts',projects='null' WHERE user_id=?").run(member.id);
 const denied=await get(member.cookie);assert.equal(denied.businesses[0].metrics,null);assert.equal(denied.businesses[0].daily,null);
 const empty=await (await worker.fetch(s.req('/api/company?start=2027-01-01&end=2027-01-02',owner.cookie),s.env)).json() as any;
 assert.deepEqual(empty.businesses[0].daily,[]);assert.equal(empty.businesses[0].metrics.revenue,null);
});

test('事業は複数の収益方法とチャネルを持ち、競合と権限違反を拒否する',async()=>{
 const s=setup(),owner=await s.enroll(),send=(body:unknown)=>worker.fetch(s.req('/api/marketing/businesses',owner.cookie,body),s.env);
 const original=(await (await worker.fetch(s.req('/api/me?include=businesses',owner.cookie),s.env)).json() as any).businesses;
 assert.deepEqual(original.find((b:any)=>b.id==='affiliate').revenueModels,['affiliate']);
 const body={action:'create',id:'mixed-business',name:'複合事業',revenueModels:['content','affiliate'],acquisitionChannels:['seo','ads']};
 let r=await send(body);assert.equal(r.status,200);let saved=await r.json() as any;assert.deepEqual(saved.revenueModels,body.revenueModels);assert.deepEqual(saved.acquisitionChannels,body.acquisitionChannels);
 const update={...body,action:'configure',expectedVersion:0,name:'変更後の事業',acquisitionChannels:['seo','sns']};
 assert.equal((await send(update)).status,200);assert.equal((await send({...update,name:'古い編集'})).status,409);
 r=await send({...update,expectedVersion:1,revenueModels:['invalid']});assert.equal(r.status,400);
 assert.equal((await send({...body,id:'bad',acquisitionChannels:['seo','seo']})).status,400);
 const list=(await (await worker.fetch(s.req('/api/marketing/businesses',owner.cookie),s.env)).json() as any).businesses;
 saved=list.find((b:any)=>b.id===body.id);assert.equal(saved.name,update.name);assert.equal(saved.profileVersion,1);assert.deepEqual(saved.acquisitionChannels,['seo','sns']);
 const staff=await s.enroll('member','staff@example.com');assert.equal((await worker.fetch(s.req('/api/marketing/businesses',staff.cookie,{...update,expectedVersion:1}),s.env)).status,403);
 const memberList=await (await worker.fetch(s.req('/api/marketing/businesses',staff.cookie),s.env)).json() as any;assert.equal(memberList.businesses.some((b:any)=>b.id===body.id),false);
 assert.equal((await send({action:'archive',id:body.id})).status,200);assert.equal((await send({...update,expectedVersion:1})).status,409);
});
