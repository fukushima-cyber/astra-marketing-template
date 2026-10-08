import {journeyAttribution} from './journey-attribution.ts';
import {can,permission,type Identity} from '../lib/access.ts';
import {validDate} from '../lib/analytics/model.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {journeyDetailKeys,journeyDetailEvents,emptySources,validateEvent,eventDay,summarizeJourney,type JourneyEvent,type JourneySource,type SourceState} from '../lib/journey/model.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,Conflict,digest} from './storage.ts';
import type {Env} from './types.ts';
const json=(v:unknown,status=200)=>Response.json(v,{status});
const clean=(s:JourneySource)=>{const {tokenHash,...v}=s;return{...v,authenticated:!!tokenHash};};
async function record(env:Env,scope:string,source:JourneySource,raw:unknown,verified:boolean){
 const v=validateEvent(raw,source,verified),{adConnectionId,campaignId,adId,...canonical}=v,signature=await digest(JSON.stringify(canonical)),id=await digest(JSON.stringify([scope,source.id,v.externalId]));
 const old=await env.DB.prepare('SELECT signature FROM journey_events WHERE id=?').bind(id).first<{signature:string}>();
 if(old){if(old.signature!==signature)throw new Conflict('同じ元イベントIDに異なる内容が届きました。訂正として新しいIDで記録してください。');return{id,replay:true};}
 if(v.supersedes){const prior=await env.DB.prepare('SELECT data FROM journey_events WHERE id=? AND business_id=? AND source_id=?').bind(v.supersedes,scope,source.id).first<{data:string}>();const e=prior?JSON.parse(prior.data) as JourneyEvent:null;
 if(!e||e.leadId!==v.leadId||e.kind!==v.kind||!e.verified||!verified||!v.reason.trim())throw new Error('訂正する記録と顧客ID・成果の種類を合わせ、訂正理由を記入してください。');
 v.adConnectionId=e.adConnectionId;v.campaignId=e.campaignId;v.adId=e.adId;
 if(await env.DB.prepare('SELECT id FROM journey_events WHERE supersedes=?').bind(v.supersedes).first())throw new Conflict('すでに訂正されています。最新の記録を選んでください。');}
 const e:JourneyEvent={...v,id,receivedAt:new Date().toISOString()};
 try{await env.DB.prepare('INSERT OR IGNORE INTO journey_events(id,business_id,project_id,source_id,external_id,day,lead_id,signature,data,supersedes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,scope,source.projectId,source.id,v.externalId,eventDay(e),v.leadId,signature,JSON.stringify(e),v.supersedes||null).run();}catch{throw new Conflict('記録が競合しました。元イベントIDと訂正元を確認してください。');}
 const written=await env.DB.prepare('SELECT signature FROM journey_events WHERE id=?').bind(id).first<{signature:string}>();if(written?.signature!==signature)throw new Conflict('同じイベントが別の内容で記録されています。');return{id,replay:false};
}
export async function journey(r:Request,env:Env,user:Identity,scope:string){
 if(!can(user,scope,'analytics'))return json({error:'実績を閲覧する権限がありません。'},403);
 try{const docId=documentId(scope,'journey-sources'),doc=await readDocument(env.DB,docId,emptySources),projects=permission(user,scope,'analytics')?.projects??null;
 if(r.method==='POST'){
 if(user.role!=='owner')return json({error:'成果の記録・接続設定は全体管理者が行います。'},403);
 const raw=await r.text();if(raw.length>30000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw);
 const source=doc.data.sources.find(s=>s.id===b.sourceId);
 if(b.action==='record'){if(!source?.enabled)throw new Error('有効な取得元を選んでください。');return json(await record(env,scope,source,b.event,true));}
 if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId))throw new Error('版と操作番号を確認してください。');
 let sources=doc.data.sources,token:string|undefined;
 if(b.action==='save_source'){
 const s=b.source as JourneySource,old=sources.find(x=>x.id===s?.id),business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data,f=business.funnels?.find(x=>x.id===s?.funnelId);
 if(!s||!f||f.projectId!==s.projectId||!f.stages.some(x=>x.id===s.stageId)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!['external','utage','manual'].includes(s.provider)||typeof s.enabled!=='boolean')throw new Error('案件・ファネル・段階・取得元を確認してください。');
 for(const key of ['url','connectionId','nativeFunnelId','pageId','adConnectionId','campaignId','adId'] as const)if(typeof s[key]!=='string'||s[key].length>500)throw new Error('取得元の項目を確認してください。');
 if(s.provider==='external'){const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('LPはクエリーを含まないHTTPS URLで指定してください。');}
 if(s.provider==='utage'){const c=await env.DB.prepare("SELECT targets FROM native_connections WHERE id=? AND business_id=? AND provider='utage'").bind(s.connectionId,scope).first<{targets:string}>();if(!c||!JSON.parse(c.targets).some((x:{id:string})=>x.id===s.nativeFunnelId)||!s.pageId)throw new Error('この事業に接続したUTAGEファネルとページIDを指定してください。');const pages=(await env.DB.prepare('SELECT data FROM native_snapshots WHERE business_id=? AND connection_id=? AND resource_id=? ORDER BY day DESC LIMIT 100').bind(scope,s.connectionId,'pages:'+s.nativeFunnelId).all<{data:string}>()).results;if(!pages.some(r=>JSON.parse(r.data).some((p:{id:string;funnelId:string})=>p.id===s.pageId&&p.funnelId===s.nativeFunnelId)))throw new Error('取得済みのUTAGEページを選んでください。');}
 if(s.adConnectionId&&!await env.DB.prepare('SELECT id FROM ad_reporting_connections WHERE id=? AND business_id=?').bind(s.adConnectionId,scope).first())throw new Error('この事業の広告接続を選んでください。');
 if(old&&JSON.stringify([old.projectId,old.funnelId,old.stageId])!==JSON.stringify([s.projectId,s.funnelId,s.stageId])&&await env.DB.prepare('SELECT id FROM journey_events WHERE source_id=? AND business_id=? LIMIT 1').bind(old.id,scope).first())throw new Error('記録済みの取得元は案件・段階を変更できません。別の取得元を追加してください。');
 if(s.id&&!old)throw new Error('取得元が見つかりません。');if(!old&&sources.length>=100)throw new Error('取得元は100件までです。');
 const v:JourneySource={id:old?.id??crypto.randomUUID(),name:s.name.trim(),projectId:s.projectId,funnelId:s.funnelId,stageId:s.stageId,provider:s.provider,url:s.url,connectionId:s.connectionId,nativeFunnelId:s.nativeFunnelId,pageId:s.pageId,adConnectionId:s.adConnectionId,campaignId:s.campaignId,adId:s.adId,enabled:s.enabled,tokenHash:old&&JSON.stringify([old.projectId,old.funnelId,old.stageId])===JSON.stringify([s.projectId,s.funnelId,s.stageId])?old.tokenHash:undefined,updatedAt:new Date().toISOString()};sources=[...sources.filter(x=>x.id!==v.id),v];
 }else if(b.action==='stop_source'){if(!source)throw new Error('取得元が見つかりません。');sources=sources.map(s=>s.id===source.id?{...s,enabled:false,updatedAt:new Date().toISOString()}:s);
 }else if(b.action==='issue_token'){if(!source?.enabled)throw new Error('有効な取得元を選んでください。');token=crypto.randomUUID()+crypto.randomUUID();sources=sources.map(s=>s.id===source.id?{...s,tokenHash:undefined,updatedAt:new Date().toISOString()}:s);const hash=await digest(token);sources=sources.map(s=>s.id===source.id?{...s,tokenHash:hash}:s);
 }else throw new Error('操作を確認してください。');
 const state:SourceState={version:b.expectedVersion+1,sources};const saved=await commitDocument(env.DB,docId,b.expectedVersion,state,b.requestId,await digest(raw));if(token&&saved.sources.find(s=>s.id===b.sourceId)?.tokenHash!==await digest(token))token=undefined;return json({state:{...saved,sources:saved.sources.map(clean)},token});
 }
 if(r.method!=='GET')return json({error:'操作できません。'},405);
 const u=new URL(r.url),start=u.searchParams.get('start')??'',end=u.searchParams.get('end')??'';if(!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>365*86400000)throw new Error('366日以内の期間を指定してください。');
 const rows=(await env.DB.prepare("SELECT data FROM journey_events WHERE business_id=? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?))) AND ((day>=? AND day<=?) OR (lead_id<>'' AND lead_id IN (SELECT lead_id FROM journey_events WHERE business_id=? AND day>=? AND day<=? AND lead_id<>'')) OR supersedes IS NOT NULL) ORDER BY id LIMIT 5001").bind(scope,projects===null?null:JSON.stringify(projects),JSON.stringify(projects),start,end,scope,start,end).all<{data:string}>()).results;
 const partial=rows.length>5000,events=partial?[]:rows.map(x=>JSON.parse(x.data) as JourneyEvent),sources=doc.data.sources.filter(s=>projects===null||projects.includes(s.projectId));
 const detailKey=u.searchParams.get('detail');if(detailKey&&!journeyDetailKeys.includes(detailKey))throw new Error('指標を確認してください。');const sourceId=u.searchParams.get('sourceId');if(sourceId&&!sources.some(s=>s.id===sourceId))throw new Error('取得元が閲覧範囲にありません。');
 let detail:unknown;
 if(detailKey){if(partial)throw new Error('集計範囲が5,000件を超えています。期間を短くしてください。');const selected=journeyDetailEvents(sourceId?events.filter(e=>e.sourceId===sourceId):events,detailKey,start,end);const label=(id:string)=>sources.find(s=>s.id===id)?.name??'過去の取得元';
 if(user.role==='owner')detail={columns:['発生日時','取得元','顧客ID','金額（円）','理由','元イベントID','記録ID'],rows:selected.map(e=>[e.occurredAt,label(e.sourceId),e.leadId,e.amount,e.reason,e.externalId,e.id])};
 else {const groups=new Map<string,typeof selected>();for(const e of selected){const key=JSON.stringify([eventDay(e),e.sourceId]);groups.set(key,[...(groups.get(key)??[]),e]);}detail={columns:['発生日','取得元','対象数','金額（円）'],rows:[...groups.values()].map(es=>[eventDay(es[0]),label(es[0].sourceId),es.length,es.some(e=>e.amount!==null)?es.reduce((n,e)=>n+(e.amount??0),0):null])};}
 }
 const requestedCampaign=u.searchParams.get('detailCampaign')??'';if(requestedCampaign){const key=JSON.parse(requestedCampaign);if(!Array.isArray(key)||key.length!==2||key.some(k=>typeof k!=='string'||k.length>150))throw new Error('キャンペーンを確認してください。');if(partial||projects!==null||!can(user,scope,'ads'))return json({error:'キャンペーンの内訳は閲覧範囲外です。'},403);}
 const attribution=!partial&&projects===null&&can(user,scope,'ads')?await journeyAttribution(env,scope,sources,events,start,end,requestedCampaign):[];
 return json({...(detailKey?{detail}:{}),attribution,state:{version:doc.version,sources:sources.map(clean)},summary:partial||!events.length?null:summarizeJourney(events,start,end),stages:partial?[]:sources.map(s=>({sourceId:s.id,summary:summarizeJourney(events.filter(e=>e.sourceId===s.id),start,end)})),events:user.role==='owner'&&!partial?events.filter(e=>eventDay(e)>=start&&eventDay(e)<=end).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,200):[],partial});
 }catch(e){return json({error:e instanceof Error?e.message:'処理できませんでした。'},e instanceof Conflict?409:400);}
}
async function lookupSource(env:Env,id:string){if(!/^[-a-zA-Z0-9]{36}$/.test(id))return null;const rows=(await env.DB.prepare("SELECT b.id,d.data FROM documents d JOIN businesses b ON d.id=CASE WHEN b.id='default' THEN 'journey-sources' ELSE b.id||':journey-sources' END WHERE b.archived_at IS NULL LIMIT 1000").all<{id:string;data:string}>()).results;for(const row of rows){const source=(JSON.parse(row.data) as SourceState).sources?.find(s=>s.id===id&&s.enabled);if(source)return{scope:row.id,source};}return null;}
export async function ingestJourney(r:Request,env:Env){
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};
 if(r.method==='OPTIONS')return new Response(null,{status:204,headers});if(r.method!=='POST')return json({error:'POSTのみ利用できます。'},405);
 try{const raw=await r.text();if(raw.length>4000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw),found=await lookupSource(env,b.sourceId);if(!found)return new Response(JSON.stringify({error:'取得元が見つかりません。'}),{status:404,headers});
 const {scope,source}=found,authorization=r.headers.get('Authorization'),verified=!!authorization?.startsWith('Bearer ')&&!!source.tokenHash&&await digest(authorization.replace(/^Bearer /,''))===source.tokenHash;
 if(authorization&&!verified)return new Response(JSON.stringify({error:'認証情報を確認してください。'}),{status:401,headers});
 if(!verified){const origin=r.headers.get('Origin');if(source.provider!=='external'||!origin||origin!==new URL(source.url).origin||b.event?.path!==new URL(source.url).pathname)throw new Error('LPの接続元が一致しません。');}
 await env.DB.prepare("DELETE FROM login_limits WHERE id LIKE 'journey:%' AND expires<?").bind(Date.now()).run();
 const rateId='journey:'+await digest(source.id+':'+(r.headers.get('CF-Connecting-IP')??'unknown')+':'+Math.floor(Date.now()/60000));
 await env.DB.prepare('INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=login_limits.attempts+1').bind(rateId,Date.now()+120000).run();
 const rate=await env.DB.prepare('SELECT attempts FROM login_limits WHERE id=?').bind(rateId).first<{attempts:number}>();if((rate?.attempts??0)>(verified?600:120))return new Response(JSON.stringify({error:'送信回数を減らして再送してください。'}),{status:429,headers});
 const result=await record(env,scope,source,b.event,verified);return new Response(JSON.stringify(result),{headers:{...headers,'Content-Type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'記録できませんでした。'}),{status:e instanceof Conflict?409:400,headers:{...headers,'Content-Type':'application/json'}});}
}
export function tracker(r:Request){const origin=new URL(r.url).origin;return new Response(`(()=>{const script=document.currentScript;const sourceId=new URL(script.src).searchParams.get('source');if(!sourceId)return;const key='astra-visit:'+sourceId;try{let q=JSON.parse(sessionStorage.getItem(key)||'null');if(!q){q={sourceId,event:{externalId:crypto.randomUUID(),kind:'visit',occurredAt:new Date().toISOString(),sessionId:sessionStorage.getItem('astra-session:'+sourceId)||crypto.randomUUID(),path:location.pathname}};sessionStorage.setItem('astra-session:'+sourceId,q.event.sessionId);sessionStorage.setItem(key,JSON.stringify(q));}dispatchEvent(new CustomEvent('astra:journey-ready',{detail:{sourceId,sessionId:q.event.sessionId}}));let attempts=0;async function send(){if(!q||attempts++>=5)return;try{const r=await fetch(${JSON.stringify(origin+'/api/ingest/journey')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q),keepalive:true});if(r.ok){sessionStorage.removeItem(key);q=null;}else if(r.status!==429&&r.status<500){q=null;}}catch{}if(q)setTimeout(send,Math.min(30000,1000*2**attempts));}send();addEventListener('online',send);}catch{}})();`,{headers:{'Content-Type':'application/javascript; charset=utf-8'}});}
