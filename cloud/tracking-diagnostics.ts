import type {Env} from './types.ts';
import {can,permission,type Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
import {readDocument} from './storage.ts';
import {emptySources,activeEvents,eventDay,type JourneyEvent,type SourceState} from '../lib/journey/model.ts';
import {validDate} from '../lib/analytics/model.ts';
import {daysIn,type AdReport} from '../lib/ads/reporting.ts';
export async function trackingDiagnostics(r:Request,env:Env,user:Identity,scope:string){
 if(r.method!=='GET')return Response.json({error:'閲覧専用です。'},{status:405});
 if(!can(user,scope,'analytics'))return Response.json({error:'実績の閲覧権限がありません。'},{status:403});
 // Account-wide reports cannot be disclosed through a project-limited analytics grant.
 if(permission(user,scope,'analytics')?.projects!==null)return Response.json({error:'事業全体の分析権限が必要です。'},{status:403});
 const q=new URL(r.url).searchParams,start=q.get('start')??'',end=q.get('end')??'';
 if(!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>365*86400000)return Response.json({error:'366日以内の期間を指定してください。'},{status:400});
 const sources=(await readDocument<SourceState>(env.DB,documentId(scope,'journey-sources'),emptySources)).data.sources;
 const raw=(await env.DB.prepare('SELECT data FROM journey_events WHERE business_id=? AND ((day>=? AND day<=?) OR supersedes IS NOT NULL) ORDER BY id LIMIT 5001').bind(scope,start,end).all<{data:string}>()).results;
 const partial=raw.length>5000,events=partial?[]:activeEvents(raw.map(x=>JSON.parse(x.data) as JourneyEvent)).filter(e=>eventDay(e)>=start&&eventDay(e)<=end);
 const routes=sources.map(s=>{const rows=events.filter(e=>e.sourceId===s.id),visits=rows.filter(e=>e.kind==='visit'&&!e.verified),outcomes=rows.filter(e=>e.verified&&e.kind!=='visit');return {id:s.id,name:s.name,provider:s.provider,enabled:s.enabled,serverKey:s.provider==='manual'?'対象外':s.tokenHash?'発行済み':'未発行',browserReception:s.provider!=='external'?'対象外':partial?'集計上限超過':visits.length?'受信記録あり':'未確認',outcomeReception:partial?'集計上限超過':outcomes.length?'認証付き記録あり':'未確認',visits:partial?null:visits.length||null,outcomes:partial?null:outcomes.length||null,lastRecorded:rows.map(e=>e.receivedAt).sort().at(-1)??null,installation:'LP・UTAGE側の設置状況は未確認',metaDelivery:'未確認（このツールからCAPI送信はしていません）'};});
 const hasAds=can(user,scope,'ads'),comparisons:unknown[]=[];let unmapped:number|null=null,mediaPartial=false;
 if(hasAds){
 const connections=(await env.DB.prepare("SELECT id,name,timezone,last_error FROM ad_reporting_connections WHERE business_id=? AND provider='meta' ORDER BY name").bind(scope).all<{id:string;name:string;timezone:string;last_error:string|null}>()).results;
 const budget=await env.DB.prepare("SELECT SUM(length(d.data)) AS bytes FROM ad_reporting_days d JOIN ad_reporting_connections c ON c.id=d.connection_id WHERE c.business_id=? AND c.provider='meta' AND d.day>=? AND d.day<=?").bind(scope,start,end).first<{bytes:number|null}>();
 const overBudget=(budget?.bytes??0)>4*1024*1024;
 const days=overBudget?[]:(await env.DB.prepare("SELECT d.connection_id,d.day,d.data,d.collected_at FROM ad_reporting_days d JOIN ad_reporting_connections c ON c.id=d.connection_id WHERE c.business_id=? AND c.provider='meta' AND d.day>=? AND d.day<=? ORDER BY d.day LIMIT 5001").bind(scope,start,end).all<{connection_id:string;day:string;data:string;collected_at:string}>()).results;
 const reportsPartial=overBudget||days.length>5000,expected=daysIn(start,end).length;
 mediaPartial=reportsPartial;
 for(const c of connections){
 const snapshots=reportsPartial?[]:days.filter(d=>d.connection_id===c.id),reports=snapshots.flatMap(d=>(JSON.parse(d.data) as AdReport[]).map(report=>({...report,collectedAt:d.collected_at}))),matched=events.filter(e=>e.verified&&e.kind==='sale'&&e.adConnectionId===c.id);
 const campaigns=[...new Set([...reports.map(x=>x.campaignId),...matched.map(x=>x.campaignId).filter((v):v is string=>!!v),...sources.filter(s=>s.adConnectionId===c.id&&s.campaignId).map(s=>s.campaignId)])];
 if(!campaigns.length){comparisons.push({connection:c.name,campaignId:'',campaignName:'キャンペーン未取得',ownSales:null,metaPurchases:null,difference:null,coverage:snapshots.length,expected,latest:null,status:reportsPartial?'集計上限超過':'未取得',reasons:[reportsPartial?'媒体実績が集計上限を超えています。期間を短くしてください。':'キャンペーン別の実績がありません。']});continue;}
 for(const campaignId of campaigns){const rows=reports.filter(x=>x.campaignId===campaignId),sales=matched.filter(e=>e.campaignId===campaignId),latest=snapshots.map(d=>d.collected_at).sort().at(-1)??null;
 const complete=snapshots.length===expected&&!reportsPartial,stale=!latest||Date.now()-Date.parse(latest)>48*3600000,valid=rows.length>0&&rows.every(x=>typeof x.conversions==='number'&&Number.isFinite(x.conversions)&&x.conversions>=0),ownSales=partial?null:sales.length||null;
 const reasons=['Metaの帰属期間と日付基準は未確認です。','自社の成約とMetaのWeb購入が同じ成果を表すか確認が必要です。'];if(!complete)reasons.push('媒体実績に未取得の日または集計上限超過があります。');if(stale)reasons.push('取得から48時間以上経過、または取得日時がありません。');if(c.timezone!=='Asia/Tokyo')reasons.push('アカウントの時間帯が日本時間と異なります。');if(c.last_error)reasons.push('媒体の同期エラーがあります。');if(!ownSales)reasons.push('広告ID付きの自社成約記録が未取得です。0件とは確定できません。');if(!valid)reasons.push('Metaの購入指標が欠測しています。');if(partial)reasons.push('自社成果が集計上限を超えています。');
 comparisons.push({connection:c.name,campaignId,campaignName:rows[0]?.campaignName??campaignId,ownSales,metaPurchases:valid?rows.reduce((n,r)=>n+r.conversions!,0):null,difference:null,coverage:snapshots.length,expected,latest,status:'条件未確認',reasons});
 }
 }
 unmapped=partial?null:events.filter(e=>e.verified&&e.kind==='sale'&&(!e.adConnectionId||!e.campaignId)).length;
 }
 return Response.json({start,end,partial,mediaPartial,routes,comparisons,adsAccess:hasAds,unmappedSales:unmapped,metaProtocol:{capi:'このツールでは未実装',pixel:'外部LP・UTAGE側の設定は未確認',deduplication:'会社DB内の重複排除と、MetaのPixel/CAPI重複排除は別',matching:'Meta側の照合状況は取得していません',attribution:'広告セット設定を使用。具体的な期間と日付基準は未確認'},note:'送信受付、照合、広告CVへの計上は別の状態です。受信記録がないことをゼロ件や設置失敗と断定しません。'});
}
