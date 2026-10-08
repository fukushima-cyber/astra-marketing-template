import {activeEvents,eventDay,type JourneyEvent,type JourneySource} from '../lib/journey/model.ts';
import {daysIn} from '../lib/ads/reporting.ts';
import type {Env} from './types.ts';
export async function journeyAttribution(env:Env,scope:string,sources:JourneySource[],events:JourneyEvent[],start:string,end:string,detailKey=''){
 const active=activeEvents(events).filter(e=>e.verified),keys=[...new Set(active.filter(s=>s.kind==='registration'&&s.adConnectionId&&s.campaignId).map(s=>JSON.stringify([s.adConnectionId,s.campaignId])))];
 const person=(e:JourneyEvent)=>JSON.stringify([e.projectId,e.leadId]);
 const registrations=active.filter(e=>e.kind==='registration'),assignment=new Map<string,Set<string>>();for(const e of registrations){const s=e;if(!s.adConnectionId||!s.campaignId)continue;const p=person(e);if(!assignment.has(p))assignment.set(p,new Set());assignment.get(p)!.add(JSON.stringify([s.adConnectionId,s.campaignId]));}
 const output=[];for(const key of keys){const [connectionId,campaignId]=JSON.parse(key),c=await env.DB.prepare('SELECT name,currency,timezone,last_error FROM ad_reporting_connections WHERE id=? AND business_id=?').bind(connectionId,scope).first<{name:string;currency:string;timezone:string;last_error:string|null}>();
 const rows=(await env.DB.prepare('SELECT day,data,collected_at FROM ad_reporting_days WHERE connection_id=? AND day>=? AND day<=? ORDER BY day').bind(connectionId,start,end).all<{day:string;data:string;collected_at:string}>()).results;
 const days=daysIn(start,end),campaignRows=rows.flatMap(r=>(JSON.parse(r.data) as {campaignId:string;spend:number|null}[]).filter(d=>d.campaignId===campaignId));
 const reason=!c||c.currency!=='JPY'||c.timezone!=='Asia/Tokyo'?'円建て・日本時間の接続ではありません':c.last_error?'接続に取得エラーがあります':days.some(d=>!rows.some(r=>r.day===d))?'広告費の未取得日があります':!campaignRows.length?'キャンペーンIDに一致する広告実績がありません':campaignRows.some(r=>r.spend===null)?'広告費に欠測があります':rows.some(r=>Date.now()-Date.parse(r.collected_at)>48*3600000)?'広告費の取得から48時間以上経っています':'';
 const sourceIds=new Set(sources.filter(s=>JSON.stringify([s.adConnectionId,s.campaignId])===key).map(s=>s.id));
 const candidates=registrations.filter(e=>JSON.stringify([e.adConnectionId,e.campaignId])===key&&eventDay(e)>=start&&eventDay(e)<=end),ambiguous=new Set(candidates.filter(e=>(assignment.get(person(e))?.size??0)>1).map(person));
 const registered=new Map<string,string>();for(const e of candidates.filter(e=>!ambiguous.has(person(e)))){const p=person(e);if(!registered.has(p)||registered.get(p)!>e.occurredAt)registered.set(p,e.occurredAt);}
 const reached=(kind:string)=>new Set(active.filter(e=>e.kind===kind&&registered.has(person(e))&&e.occurredAt>=registered.get(person(e))!).map(person)).size;
 const spend=reason?null:campaignRows.reduce((n,r)=>n+r.spend!,0),qualified=reached('qualified'),sales=reached('sale');
 let detail:unknown;
 if(key===detailKey){const entries:(string|number|null)[][]=[];
 for(const row of rows)for(const report of (JSON.parse(row.data) as {campaignId:string;spend:number|null}[]).filter(d=>d.campaignId===campaignId))entries.push([row.day,'広告費',report.spend]);
 const grouped=(kind:string,people:Map<string,string>)=>{const days=new Map<string,number>();for(const at of people.values()){const day=new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10);days.set(day,(days.get(day)??0)+1);}for(const [date,count] of days)entries.push([date,kind,count]);};
 grouped('登録者',registered);
 for(const kind of ['qualified','sale']){const people=new Map<string,string>();for(const e of active.filter(e=>e.kind===kind&&registered.has(person(e))&&e.occurredAt>=registered.get(person(e))!)){const old=people.get(person(e));if(!old||e.occurredAt<old)people.set(person(e),e.occurredAt);}grouped(kind==='sale'?'成約者':'有効申込者',people);}
 const ambiguousDates=new Map<string,string>();for(const e of candidates.filter(e=>ambiguous.has(person(e)))){const old=ambiguousDates.get(person(e));if(!old||e.occurredAt<old)ambiguousDates.set(person(e),e.occurredAt);}grouped('対応の曖昧な登録者',ambiguousDates);
 detail={columns:['発生日','指標','記録値'],rows:entries.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),note:reason||'選択期間の登録者を基準に、期間後の有効申込・成約も追跡します。複数キャンペーンへの対応がある顧客は除外しています。'};
 }
 output.push({...(detail?{detail}:{}),connectionId,campaignId,name:c?.name??'接続なし',sourceIds:[...sourceIds],spend,registrations:registered.size,qualified,sales,ambiguous:ambiguous.size,registrationCost:spend!==null&&registered.size?spend/registered.size:null,qualifiedCost:spend!==null&&qualified?spend/qualified:null,saleCost:spend!==null&&sales?spend/sales:null,reason});
 }return output;
}
