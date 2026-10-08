import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {adReporting} from '../cloud/ad-reporting.ts';
import {createReportingClient,validateCredentials,lineAuthorization,xAuthorization,midnight} from '../cloud/ad-reporting-providers.ts';
import {sumAdMetrics,adRatio,type AdProvider} from '../lib/ads/reporting.ts';
import type {Env,Statement} from '../cloud/types.ts';
import type {Identity} from '../lib/access.ts';
const ids={google:'1234567890',line:'123',meta:'act_123',x:'abc123',tiktok:'123',chatgpt:'adacct_123'};
const credentials={developerToken:'developer-test',token:'secret-test',clientId:'client',clientSecret:'secret-test',refreshToken:'refresh-test',accessKey:'access',secretKey:'secret-test',currency:'JPY',timezone:'Asia/Tokyo',consumerKey:'key',consumerSecret:'secret-test',accessToken:'access',accessTokenSecret:'secret-test'};
function mock(p:AdProvider,options:{failReport?:boolean;secondPage?:boolean;badId?:boolean}={}){const original=globalThis.fetch;const calls:{url:URL;init:RequestInit|undefined}[]=[];
 globalThis.fetch=async(input,init)=>{const u=new URL(String(input));calls.push({url:u,init});const id=options.badId?'wrong':ids[p],meta={id,name:'検証用',currency:'JPY',timezone:'Asia/Tokyo'},metrics={spend:'12.5',impressions:'100',clicks:'0'};
 if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'oauth-access'});
 const query=init?.body?JSON.parse(String(init.body)):null;
 const report=u.pathname.includes('insights')||u.pathname.includes('report')||u.pathname.includes('/stats/')||query?.query?.includes('metrics.');
 if(options.failReport&&report)return Response.json({error:'secret-test'}, {status:403});
 if(p==='google')return Response.json({results:query.query.includes('metrics.')?[{segments:{date:'2026-09-01'},campaign:{id:'1',name:'検証用'},metrics:{costMicros:'12500000',impressions:'100',clicks:'0',conversions:'2',conversionsValue:'600'}}]:[{customer:{id,descriptiveName:'検証用',currencyCode:'JPY',timeZone:'Asia/Tokyo'}}]});
 if(p==='meta')return Response.json(report?{data:[{date_start:'2026-09-01',campaign_id:'1',campaign_name:'検証用',...metrics,actions:[{action_type:'purchase',value:'90'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'2'}]}]}:{...meta,timezone_name:meta.timezone});
 if(p==='line')return Response.json(report?{datas:[{adaccount:{id},campaign:{id:1,name:'検証用'},statistics:{currency:'JPY',cost:12.5,imp:100,click:0,cvWithCvApi:2}}],paging:{totalElements:1,page:1}}:meta);
 if(p==='tiktok')return Response.json({code:0,data:report?{list:[{dimensions:{campaign_id:'1',stat_time_day:'2026-09-01 00:00:00'},metrics:{...metrics,campaign_name:'検証用',conversion:'2'}}],page_info:{total_page:1}}:{list:[{...meta,advertiser_id:id}]}});
 if(p==='chatgpt'){if(!report)return Response.json({...meta,currency_code:'JPY'});if(options.secondPage&&u.searchParams.has('after'))return Response.json({data:[{campaign_id:'2',campaign_name:'検証2',readable_time:'2026-09-01',...metrics}],has_more:false});return Response.json({data:[{campaign_id:'1',campaign_name:'検証用',readable_time:'2026-09-01',...metrics}],has_more:!!options.secondPage,last_id:'opaque-cursor'});}
 if(u.pathname.endsWith('/campaigns'))return Response.json({data:[{id:'1',name:'検証用'}],next_cursor:null});
 if(report)return Response.json({time_series_length:1,data:[{id:'1',id_data:[{segment:null,metrics:{billed_charge_local_micro:[12500000],impressions:[100],clicks:[0]}}]}]});return Response.json({data:meta});
 };
 return {calls,restore:()=>{globalThis.fetch=original;}};
}
for(const p of ['google','line','meta','x','tiktok','chatgpt'] as AdProvider[])test(p+'：公式形式からアカウントと日別費用を取得し、0と欠測を区別',async()=>{const m=mock(p);try{const client=createReportingClient(p,ids[p],credentials),a=await client.account(),rows=await client.reports(a,'2026-09-01','2026-09-01');assert.equal(a.id,ids[p]);assert.equal(rows[0].spend,12.5);assert.equal(rows[0].clicks,0);assert.equal(rows[0].conversions,['x','chatgpt'].includes(p)?null:2);assert.ok(m.calls.every(c=>c.init?.redirect==='error'));assert.ok(m.calls.every(c=>!c.url.href.includes('secret-test')));if(p==='x'){assert.equal(rows.length,3);assert.equal(m.calls.find(c=>c.url.pathname.includes('/stats/'))?.url.searchParams.get('start_time'),'2026-08-31T15:00:00.000Z');}if(p==='google')assert.equal((m.calls[1].init?.headers as Record<string,string>)?.['developer-token'],'developer-test');}finally{m.restore();}});
test('ChatGPTのカーソルを追い、正しいfieldsと時間帯を送る',async()=>{const m=mock('chatgpt',{secondPage:true});try{const c=createReportingClient('chatgpt',ids.chatgpt,credentials),rs=await c.reports(await c.account(),'2026-09-01','2026-09-01');assert.equal(rs.length,2);assert.ok(m.calls[1].url.searchParams.getAll('fields[]').includes('campaign.spend'));assert.equal(m.calls[2].url.searchParams.get('after'),'opaque-cursor');}finally{m.restore();}});
test('LINE署名は公式サンプルのパディングと改行を再現',async()=>{const s=await lineAuthorization({accessKey:'LINEADSAMPLE',secretKey:'LINEADSECRETKEYSAMPLE'},'/api/v3/adaccounts/A1/campaigns',new Date('2021-12-22T00:00:00Z'));const [h,p,signature]=s.slice(7).split('.');assert.deepEqual(JSON.parse(Buffer.from(h,'base64url').toString()),{alg:'HS256',kid:'LINEADSAMPLE',typ:'text/plain'});assert.ok(Buffer.from(p,'base64url').toString().endsWith('\n\n20211222\n/api/v3/adaccounts/A1/campaigns'));assert.equal(signature,createHmac('sha256','LINEADSECRETKEYSAMPLE').update(h+'.'+p).digest('base64').replaceAll('+','-').replaceAll('/','_'));});
test('X署名はOAuth 1.0の既知ベクトルと一致し、DSTの日付境界も維持',async()=>{const u=new URL('http://photos.example.net/photos?file=vacation.jpg&size=original');const auth=await xAuthorization({consumerKey:'dpf43f3p2l4k3l03',consumerSecret:'kd94hf93k423kf44',accessToken:'nnch734d00sl2jdk',accessTokenSecret:'pfkkdhi9sl3r4s00'},u,'kllo9940pd9333jh','1191242096');assert.ok(auth.includes('tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D'));assert.equal(midnight('2026-03-09','America/New_York'),'2026-03-09T04:00:00.000Z');});
test('取得値は欠測を隠さず、異常値・不正IDを拒否',()=>{const base={spend:0,impressions:10,clicks:0,conversions:null,conversionValue:null};assert.equal(sumAdMetrics([base,{...base,spend:null}]).spend,null);assert.equal(sumAdMetrics([]).spend,null);assert.equal(adRatio(0,10),0);assert.equal(adRatio(10,0),null);assert.throws(()=>validateCredentials('meta','https://evil.test',credentials));});
async function fixture(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));db.exec(readFileSync(new URL('./journey-schema.sql',import.meta.url),'utf8'));class Q implements Statement{args:unknown[]=[];sql:string;constructor(sql:string){this.sql=sql;}bind(...args:unknown[]){this.args=args;return this;}async first<T>(){return db.prepare(this.sql).get(...this.args as []) as T??null;}async all<T>(){return{results:db.prepare(this.sql).all(...this.args as []) as T[]};}async run(){return{meta:{changes:Number(db.prepare(this.sql).run(...this.args as []).changes)}};}}
 const env={CONNECTOR_KEY:btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),DB:{prepare:(s:string)=>new Q(s),batch:async(ss:Statement[])=>{db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}} as Env;
 const owner:Identity={id:'owner',companyId:'company',name:'所有者',email:'test@example.test',role:'owner',version:1,grants:[]};
 const call=(body:object,user=owner,scope='default')=>adReporting(new Request('https://test/api/marketing/ad-reporting',{method:'POST',body:JSON.stringify(body)}),env,user,scope);
 return {db,env,owner,call};
}
test('暗号化・繰返し同期・日別カバレッジ・取得失敗時の保存維持',async()=>{const f=await fixture();let m=mock('chatgpt');try{const r=await f.call({action:'connect',provider:'chatgpt',externalId:ids.chatgpt,credentials});assert.equal(r.status,200);const {id}=await r.json() as any;assert.ok(!String(f.db.prepare('SELECT credential FROM ad_reporting_connections').get()!.credential).includes('secret-test'));const sync={action:'sync',id,start:'2026-09-01',end:'2026-09-02'};for(let i=0;i<2;i++)assert.equal((await f.call(sync)).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM ad_reporting_days').get()!.n,2);const get=()=>adReporting(new Request('https://test/?start=2026-09-01&end=2026-09-02'),f.env,f.owner,'default');const result=await(await get()).json() as any;assert.equal(result.reports.length,1);assert.equal(result.connections[0].coverage.length,2);assert.ok(!JSON.stringify(result).includes('credential'));m.restore();m=mock('chatgpt',{failReport:true});assert.equal((await f.call(sync)).status,400);assert.equal((await(await get()).json() as any).reports.length,1);assert.ok(!JSON.stringify(await(await get()).json()).includes('secret-test'));}finally{m.restore();f.db.close();}});
test('閲覧専用権限、別事業、重複アカウント、並行取得を拒否',async()=>{const f=await fixture(),m=mock('chatgpt');try{const body={action:'connect',provider:'chatgpt',externalId:ids.chatgpt,credentials},r=await f.call(body),{id}=await r.json() as any;const reader={...f.owner,role:'member' as const,grants:[{businessId:'default',page:'ads' as const,edit:false,projects:null}]};assert.equal((await f.call(body,reader)).status,403);assert.equal((await f.call(body,f.owner,'other')).status,400);assert.equal((await f.call({action:'sync',id,start:'2026-09-01',end:'2026-09-02'},f.owner,'other')).status,404);assert.equal((await adReporting(new Request('https://test/?start=2026-09-01&end=2026-09-02'),f.env,{...reader,grants:[]},'default')).status,403);f.db.prepare('UPDATE ad_reporting_connections SET busy_id=?,busy_until=?').run('busy','2099-01-01');assert.equal((await f.call({action:'sync',id,start:'2026-09-01',end:'2026-09-02'})).status,409);assert.equal((await f.call(body)).status,409);}finally{m.restore();f.db.close();}});
test('途中ページのエラーは部分成功扱いにせず、秘密を含む本文を返さない',async()=>{const original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return count===1?Response.json({data:[{campaign_id:'1',readable_time:'2026-09-01',spend:3}],has_more:true,last_id:'next'}):Response.json({error:'token=secret-test'},{status:500});};try{const c=createReportingClient('chatgpt',ids.chatgpt,credentials);await assert.rejects(c.reports({id:ids.chatgpt,name:'test',currency:'JPY',timezone:'Asia/Tokyo'},'2026-09-01','2026-09-01'),e=>e instanceof Error&&!e.message.includes('secret-test'));assert.equal(count,2);}finally{globalThis.fetch=original;}});

test('Xアカウントに通貨がない場合は請求元を照合し、混在通貨を拒否',async()=>{const original=globalThis.fetch;let mixed=false;globalThis.fetch=async input=>Response.json(new URL(String(input)).pathname.endsWith('funding_instruments')?{data:[{currency:'JPY'},...(mixed?[{currency:'USD'}]:[])],next_cursor:null}:{data:{id:'abc123',name:'検証用',timezone:'Asia/Tokyo'}});try{assert.equal((await createReportingClient('x','abc123',credentials).account()).currency,'JPY');mixed=true;await assert.rejects(createReportingClient('x','abc123',credentials).account());}finally{globalThis.fetch=original;}});

for(const provider of ['google','line','meta','x','tiktok','chatgpt'] as AdProvider[])test(provider+'：API失敗で保存済み日別データと最終成功時刻を削除しない',async()=>{
 const f=await fixture();let m=mock(provider);try{
 const r=await f.call({action:'connect',provider,externalId:ids[provider],credentials});assert.equal(r.status,200);const {id}=await r.json() as any;
 const sync={action:'sync',id,start:'2026-09-01',end:'2026-09-01'};assert.equal((await f.call(sync)).status,200);
 const rows=f.db.prepare('SELECT * FROM ad_reporting_days ORDER BY day').all(),last=f.db.prepare('SELECT last_sync FROM ad_reporting_connections').get()!.last_sync;
 m.restore();m=mock(provider,{failReport:true});assert.equal((await f.call(sync)).status,400);
 assert.deepEqual(f.db.prepare('SELECT * FROM ad_reporting_days ORDER BY day').all(),rows);assert.equal(f.db.prepare('SELECT last_sync FROM ad_reporting_connections').get()!.last_sync,last);
 }finally{m.restore();f.db.close();}
});
test('Google開発者トークン未設定は通信前に拒否する',async()=>{
 const m=mock('google');try{const old={...credentials};delete (old as Partial<typeof credentials>).developerToken;await assert.rejects(createReportingClient('google',ids.google,old).account());assert.equal(m.calls.length,0);}finally{m.restore();}
});


test('実績の控えは所有者だけ取得でき、他事業と認証キーを含まず、元データを変更しない',async()=>{
 const f=await fixture(),m=mock('chatgpt');try{
 const r=await f.call({action:'connect',provider:'chatgpt',externalId:ids.chatgpt,credentials});const {id}=await r.json() as any;await f.call({action:'sync',id,start:'2026-09-01',end:'2026-09-01'});
 f.db.prepare("INSERT INTO documents VALUES('affiliate:business',1,?,'')").run('{"private":"other-business"}');
 const before=f.db.prepare('SELECT * FROM ad_reporting_days').all();
 const {dataExport}=await import('../cloud/data-export.ts');
 const request=new Request('https://test/api/marketing/data-export');
 const result=await dataExport(request,f.env,f.owner,'default');assert.equal(result.status,200);
 const text=await result.text(),body=JSON.parse(text);assert.equal(body.counts.ad_reporting_days,1);assert.ok(!text.includes('secret-test'));assert.ok(!text.includes('credential'));assert.ok(!text.includes('other-business'));assert.equal(body.businessId,'default');
 assert.equal((await dataExport(request,f.env,{...f.owner,role:'member'},'default')).status,403);
 assert.equal((await dataExport(new Request('https://test',{method:'POST'}),f.env,f.owner,'default')).status,405);
 assert.deepEqual(f.db.prepare('SELECT * FROM ad_reporting_days').all(),before);
 }finally{m.restore();f.db.close();}
});
