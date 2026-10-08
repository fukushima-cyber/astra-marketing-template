import {can,permission,type Identity} from '../lib/access.ts';
import {measures,validDate,type Fact,type Measure} from '../lib/analytics/model.ts';
import {daysIn} from '../lib/ads/reporting.ts';
import {initialMetricPolicy,validateMetricPolicy,importedMetric,summarizeMetric,type MetricPolicy,type MetricResult} from '../lib/measurement/model.ts';
import type {Page} from '../lib/connected/model.ts';
import type {Env} from './types.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,digest,Conflict} from './storage.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
const json=(v:unknown,status=200)=>Response.json(v,{status});
export async function measurement(r:Request,env:Env,user:Identity,scope:string){
 if(!can(user,scope,'analytics'))return json({error:'実績を閲覧する権限がありません。'},403);
 const projects=permission(user,scope,'analytics')?.projects??null;
 const docId=documentId(scope,'measurement-policy');
 try{
 const doc=await readDocument(env.DB,docId,initialMetricPolicy);
 if(r.method==='POST'){
 if(user.role!=='owner')return json({error:'正式な取得元の変更は全体管理者が行います。'},403);
 const raw=await r.text();if(raw.length>10000)return json({error:'設定が大きすぎます。'},413);const b=JSON.parse(raw);
 if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId))throw new Error('版と操作番号を確認してください。');
 const p=validateMetricPolicy(b.policy);if(p.version!==b.expectedVersion)throw new Error('設定の版を確認してください。');
 const business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 for(const x of Object.values(p.metrics)){
 if(x.kind==='import'&&x.funnelId&&!business.funnels?.some(f=>f.id===x.funnelId))throw new Error('この事業のファネルを選んでください。');
 if(x.kind==='ads')for(const connectionId of x.connectionIds){
 const c=await env.DB.prepare('SELECT id,currency,timezone FROM ad_reporting_connections WHERE id=? AND business_id=?').bind(connectionId,scope).first<{id:string;currency:string;timezone:string}>();
 if(!c||c.currency!=='JPY'||c.timezone!=='Asia/Tokyo')throw new Error('この事業の円建て・日本時間の広告接続を選んでください。');
 }
 if(x.kind==='utage'){
 const c=await env.DB.prepare("SELECT targets FROM native_connections WHERE id=? AND business_id=? AND provider='utage'").bind(x.connectionId,scope).first<{targets:string}>();
 if(!c||!JSON.parse(c.targets).some((t:{id:string})=>t.id===x.funnelId))throw new Error('この事業で選択したUTAGEファネルを指定してください。');
 const rows=(await env.DB.prepare('SELECT data FROM native_snapshots WHERE business_id=? AND connection_id=? AND resource_id=? ORDER BY day DESC LIMIT 100').bind(scope,x.connectionId,'pages:'+x.funnelId).all<{data:string}>()).results;
 if(!rows.some(row=>(JSON.parse(row.data) as Page[]).some(page=>page.id===x.pageId&&page.funnelId===x.funnelId)))throw new Error('取得済みのUTAGEページを選んでください。');
 }
 }
 const state={...p,version:b.expectedVersion+1};return json({policy:await commitDocument(env.DB,docId,b.expectedVersion,state,b.requestId,await digest(raw))});
 }
 if(r.method!=='GET')return json({error:'操作できません。'},405);
 const u=new URL(r.url),start=u.searchParams.get('start')??'',end=u.searchParams.get('end')??'';
 if(!validDate(start)||!validDate(end)||start>end||(!daysIn(start,end).length||daysIn(start,end).length>366))return json({error:'366日以内の期間を選んでください。'},400);
 const data=(await env.DB.prepare('SELECT data FROM analytics_rows WHERE business_id=? AND date>=? AND date<=? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?))) ORDER BY id LIMIT 20001').bind(scope,start,end,projects===null?null:JSON.stringify(projects),JSON.stringify(projects)).all<{data:string}>()).results;
 if(data.length>20000)throw new Error('対象が多いため期間を短くしてください。');const facts=data.map(x=>JSON.parse(x.data) as Fact);
 const charts=u.searchParams.get('charts')==='1';const requested=u.searchParams.get('detail');if(requested&&!Object.hasOwn(measures,requested))return json({error:'指標を選んでください。'},400);
 const metrics={} as Record<Measure,MetricResult>;
 for(const key of Object.keys(measures) as Measure[]){const b=doc.data.metrics[key];
 if(b.kind==='import'){metrics[key]=importedMetric(facts,key,b,start,end,undefined,requested===key||charts);continue;}
 const required=b.kind==='ads'?'ads':'overview';
 if(projects!==null||!can(user,scope,required)){metrics[key]={...summarizeMetric([],start,end,'閲覧範囲外'),status:'restricted'};continue;}
 if(b.kind==='ads'){
 const points:import('../lib/measurement/model.ts').MetricPoint[]=[];
 const byAccount:{day:string;data:string;collected_at:string}[][]=[],names:string[]=[],errors:string[]=[];
 for(const connectionId of b.connectionIds){
 const c=await env.DB.prepare('SELECT name,currency,timezone,last_error FROM ad_reporting_connections WHERE id=? AND business_id=?').bind(connectionId,scope).first<{name:string;currency:string;timezone:string;last_error:string|null}>();
 if(!c||c.currency!=='JPY'||c.timezone!=='Asia/Tokyo'){errors.push('接続先・通貨・時間帯を確認してください。');byAccount.push([]);continue;}
 names.push(c.name);if(c.last_error)errors.push(c.name+' / '+c.last_error);
 byAccount.push((await env.DB.prepare('SELECT day,data,collected_at FROM ad_reporting_days WHERE connection_id=? AND day>=? AND day<=? ORDER BY day').bind(connectionId,start,end).all<{day:string;data:string;collected_at:string}>()).results);
 }
 for(const day of daysIn(start,end)){
 const records=byAccount.map(rows=>rows.find(row=>row.day===day));if(!records.some(Boolean))continue;
 const values=records.flatMap(row=>row?(JSON.parse(row.data) as {spend:number|null}[]).map(r=>r.spend):[]);
 points.push({date:day,value:records.every(Boolean)&&values.every(v=>v!==null)?values.reduce<number>((n,v)=>n+v!,0):null,collectedAt:records.filter(Boolean).map(row=>row!.collected_at).sort()[0],definition:'媒体配信日の費用 / JPY / Asia/Tokyo'});
 }
 metrics[key]=summarizeMetric(points,start,end,'広告API / '+names.join(', '),new Date(),requested===key||charts);if(errors.length)metrics[key].error=errors.join(' / ');
 }else{
 const c=await env.DB.prepare("SELECT label,enabled,last_error,targets FROM native_connections WHERE id=? AND business_id=? AND provider='utage'").bind(b.connectionId,scope).first<{label:string;enabled:number;last_error:string|null;targets:string}>();
 const rows=c?(await env.DB.prepare('SELECT day,data,collected_at FROM native_snapshots WHERE business_id=? AND connection_id=? AND resource_id=? AND day>=? AND day<=? ORDER BY day').bind(scope,b.connectionId,'pages:'+b.funnelId,start,end).all<{day:string;data:string;collected_at:string}>()).results:[];
 const field=key==='registrations'?'registrations':key==='sales'?'sales':'revenue';
 metrics[key]=summarizeMetric(rows.map(x=>{const p=(JSON.parse(x.data) as Page[]).find(p=>p.id===b.pageId&&p.funnelId===b.funnelId),day=p?.daily.find(d=>d.date===x.day);return{date:x.day,value:day?.[field]??null,collectedAt:x.collected_at,definition:'UTAGEページの'+(key==='sales'?'購入件数':measures[key])+' / 発生日基準'};}),start,end,'UTAGE / '+(c?.label??'接続が見つかりません'),new Date(),requested===key||charts);
 if(!c?.enabled||c.last_error||!JSON.parse(c.targets).some((t:{id:string})=>t.id===b.funnelId))metrics[key].error=c?.last_error??'取得停止中、または取得対象から外れています。';
 }
 }
 let choices:unknown=null;
 if(user.role==='owner'){
 const ads=(await env.DB.prepare('SELECT id,name,currency,timezone FROM ad_reporting_connections WHERE business_id=? ORDER BY name').bind(scope).all()).results;
 const utage=(await env.DB.prepare("SELECT n.id,n.label,n.targets,s.data FROM native_connections n LEFT JOIN native_snapshots s ON s.connection_id=n.id AND s.business_id=n.business_id AND s.resource_id LIKE 'pages:%' WHERE n.business_id=? AND n.provider='utage' ORDER BY s.day DESC LIMIT 200").bind(scope).all<{id:string;label:string;targets:string;data:string|null}>()).results;
 const pages=new Map<string,{connectionId:string;label:string;funnelId:string;pageId:string;name:string}>();
 for(const row of utage)for(const page of (row.data?JSON.parse(row.data):[]) as Page[]){if(JSON.parse(row.targets).some((t:{id:string})=>t.id===page.funnelId)){const id=JSON.stringify([row.id,page.id]);if(!pages.has(id))pages.set(id,{connectionId:row.id,label:row.label,funnelId:page.funnelId,pageId:page.id,name:page.name});}}
 const business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 const sources=(await env.DB.prepare('SELECT DISTINCT source FROM analytics_rows WHERE business_id=? ORDER BY source LIMIT 200').bind(scope).all<{source:string}>()).results.map(x=>x.source);
 choices={ads,utage:[...pages.values()],funnels:(business.funnels??[]).map(f=>({id:f.id,name:f.name})),sources};
 }
 return json({metrics,policy:projects===null?doc.data:null,choices,start,end});
 }catch(e){return json({error:e instanceof SyntaxError?'入力形式を確認してください。':e instanceof Error?e.message:'処理できませんでした。'},e instanceof Conflict?409:400);}
}
