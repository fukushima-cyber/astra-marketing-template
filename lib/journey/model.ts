import {validDate} from '../analytics/model.ts';
export const eventNames={visit:'LP閲覧（補助計測）',registration:'登録',qualified:'有効申込',booking:'予約',attendance:'着座',sale:'成約',payment:'入金',refund:'返金',disqualified:'対象外',ad_cost:'配賦した広告費'} as const;
export type EventKind=keyof typeof eventNames;
export type JourneySource={id:string;name:string;projectId:string;funnelId:string;stageId:string;provider:'external'|'utage'|'manual';url:string;connectionId:string;nativeFunnelId:string;pageId:string;adConnectionId:string;campaignId:string;adId:string;enabled:boolean;tokenHash?:string;updatedAt:string};
export type SourceState={version:number;sources:JourneySource[]};
export const emptySources:SourceState={version:0,sources:[]};
export type JourneyEvent={adConnectionId?:string;campaignId?:string;adId?:string;id:string;externalId:string;sourceId:string;projectId:string;funnelId:string;stageId:string;kind:EventKind;occurredAt:string;leadId:string;sessionId:string;amount:number|null;reason:string;supersedes:string;verified:boolean;receivedAt:string};
const str=(v:unknown,max=150):v is string=>typeof v==='string'&&v.length<=max;
export function validateEvent(v:unknown,source:JourneySource,verified:boolean,now=new Date()):Omit<JourneyEvent,'id'|'receivedAt'>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('イベントの形式を確認してください。');const e=v as JourneyEvent;
 if(!str(e.externalId)||!e.externalId.trim()||!Object.hasOwn(eventNames,e.kind)||!str(e.occurredAt,40)||!Number.isFinite(Date.parse(e.occurredAt))||Date.parse(e.occurredAt)>now.getTime()+300000||Date.parse(e.occurredAt)<now.getTime()-2*366*86400000)throw new Error('元イベントID・発生日時を確認してください。');
 if(!verified&&e.kind!=='visit')throw new Error('成果イベントはサーバーから認証して送信してください。');
 const leadId=e.leadId??'',sessionId=e.sessionId??'',reason=e.reason??'',supersedes=e.supersedes??'';
 if(!str(leadId,100)||!str(sessionId,100)||!str(reason,500)||!str(supersedes,100)||(!verified&&(leadId||supersedes||reason))||(!['visit','ad_cost'].includes(e.kind)&&(!leadId||!/^[-a-zA-Z0-9_:]{1,100}$/.test(leadId))))throw new Error('顧客は個人情報を含まない共通IDで指定してください。');
 if(['disqualified','refund'].includes(e.kind)&&!reason.trim())throw new Error('対象外や返金の理由を記入してください。');
 const money=['payment','refund','sale','ad_cost'].includes(e.kind),amount=e.amount??null;
 if(money?(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e12):amount!==null)throw new Error('金額を確認してください。金額のある記録は0以上の円で指定します。');
 return{adConnectionId:source.adConnectionId,campaignId:source.campaignId,adId:source.adId,externalId:e.externalId,sourceId:source.id,projectId:source.projectId,funnelId:source.funnelId,stageId:source.stageId,kind:e.kind,occurredAt:new Date(e.occurredAt).toISOString(),leadId,sessionId,amount,reason,supersedes,verified};
}
export const eventDay=(e:JourneyEvent)=>new Date(Date.parse(e.occurredAt)+9*3600000).toISOString().slice(0,10);
export function activeEvents(events:JourneyEvent[]){const replaced=new Set(events.map(e=>e.supersedes).filter(Boolean));return events.filter(e=>!replaced.has(e.id));}
export function summarizeJourney(events:JourneyEvent[],start:string,end:string){
 if(!validDate(start)||!validDate(end)||start>end)throw new Error('期間を確認してください。');const active=activeEvents(events),period=active.filter(e=>eventDay(e)>=start&&eventDay(e)<=end),known=period.filter(e=>e.verified);
 const counts=Object.fromEntries(Object.keys(eventNames).map(k=>[k,period.filter(e=>e.kind===k&&(k==='visit'||e.verified)).length])) as Record<EventKind,number>;
 const people=Object.fromEntries(Object.keys(eventNames).map(k=>[k,new Set(known.filter(e=>e.kind===k).filter(e=>e.leadId).map(e=>JSON.stringify([e.projectId,e.leadId]))).size])) as Record<EventKind,number>;
 const person=(e:JourneyEvent)=>JSON.stringify([e.projectId,e.leadId]);const registered=new Map<string,string>();for(const e of active.filter(e=>e.kind==='registration'&&e.verified)){const prior=registered.get(person(e));if(!prior||e.occurredAt<prior)registered.set(person(e),e.occurredAt);}
 const cohort=new Set([...registered].filter(([,d])=>{const day=new Date(Date.parse(d)+9*3600000).toISOString().slice(0,10);return day>=start&&day<=end;}).map(([id])=>id));
 const cohortCounts=Object.fromEntries(Object.keys(eventNames).map(k=>[k,new Set(active.filter(e=>e.verified&&e.kind===k&&cohort.has(person(e))&&e.occurredAt>=registered.get(person(e))!).map(e=>person(e))).size])) as Record<EventKind,number>;
 return{counts,people,cohortCounts,cohortSize:cohort.size,revenue:known.filter(e=>e.kind==='sale').reduce((n,e)=>n+e.amount!,0),payments:known.filter(e=>e.kind==='payment').reduce((n,e)=>n+e.amount!,0),refunds:known.filter(e=>e.kind==='refund').reduce((n,e)=>n+e.amount!,0),unmatched:known.filter(e=>!['visit','registration','ad_cost'].includes(e.kind)&&!registered.has(person(e))).length,reasons:[...new Set(known.filter(e=>['disqualified','refund'].includes(e.kind)).map(e=>e.reason))],recorded:period.length};
}

export const journeyDetailKeys=[...Object.keys(eventNames),'revenue','payments','refunds','unmatched','cohort','cohort_qualified','cohort_sale',...Object.keys(eventNames).map(k=>'events_'+k)] as const;
export function journeyDetailEvents(events:JourneyEvent[],key:string,start:string,end:string){
 const active=activeEvents(events),person=(e:JourneyEvent)=>JSON.stringify([e.projectId,e.leadId]);
 const registered=new Map<string,JourneyEvent>();for(const e of active.filter(e=>e.kind==='registration'&&e.verified)){const old=registered.get(person(e));if(!old||e.occurredAt<old.occurredAt)registered.set(person(e),e);}
 let rows=active.filter(e=>eventDay(e)>=start&&eventDay(e)<=end);
 if(key==='unmatched')return rows.filter(e=>e.verified&&!['visit','registration','ad_cost'].includes(e.kind)&&!registered.has(person(e)));
 if(key.startsWith('cohort')){const cohort=new Map([...registered].filter(([,e])=>eventDay(e)>=start&&eventDay(e)<=end));if(key==='cohort')return [...cohort.values()];const kind=key==='cohort_sale'?'sale':'qualified';rows=active.filter(e=>e.verified&&e.kind===kind&&cohort.has(person(e))&&e.occurredAt>=cohort.get(person(e))!.occurredAt);}
 else {const kind=key.startsWith('events_')?key.slice(7):({revenue:'sale',payments:'payment',refunds:'refund'} as Record<string,string>)[key]??key;rows=rows.filter(e=>e.kind===kind&&(kind==='visit'||e.verified));if(key.startsWith('events_')||['revenue','payments','refunds','visit','ad_cost'].includes(key))return rows;rows=rows.filter(e=>e.leadId);}
 // People cards use one person per project, unlike money cards which list all events.
 const people=new Map<string,JourneyEvent>();for(const e of rows.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)))if(!people.has(person(e)))people.set(person(e),e);return [...people.values()];
}
