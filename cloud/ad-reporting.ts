import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {seal} from './native.ts';
import {validDate} from '../lib/analytics/model.ts';
import {daysIn,type AdProvider,type AdReport} from '../lib/ads/reporting.ts';
import {createReportingClient,validateCredentials,ReportingError} from './ad-reporting-providers.ts';
type Stored={id:string;business_id:string;provider:AdProvider;external_id:string;name:string;currency:string;timezone:string;credential:string;last_sync:string|null;last_error:string|null;busy_id:string|null;busy_until:string|null};
const json=(body:unknown,status=200)=>Response.json(body,{status});
const safeError=(e:unknown)=>e instanceof ReportingError?e.message:'取得または保存が完了しませんでした。接続設定を確認して再取得してください。';
function range(start:unknown,end:unknown,max:number):asserts start is string{if(!validDate(start)||!validDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>=max)throw new ReportingError(`期間は${max}日以内で指定してください。`);}
export async function adReporting(r:Request,env:Env,user:Identity,scope:string){
 if(!can(user,scope,'ads',r.method!=='GET'))return json({error:'この事業の広告実績を閲覧・取得する権限がありません。'},403);
 try{
  if(r.method==='GET'){
   const q=new URL(r.url).searchParams,start=q.get('start'),end=q.get('end');range(start,end,366);
   const connections=(await env.DB.prepare('SELECT * FROM ad_reporting_connections WHERE business_id=? ORDER BY created_at').bind(scope).all<Stored>()).results;
   const stored=(await env.DB.prepare('SELECT d.* FROM ad_reporting_days d JOIN ad_reporting_connections c ON c.id=d.connection_id WHERE c.business_id=? AND d.day>=? AND d.day<=? ORDER BY d.day').bind(scope,start,end).all<{connection_id:string;day:string;data:string;collected_at:string}>()).results;
   const reports=stored.flatMap(d=>(JSON.parse(d.data) as AdReport[]).map(r=>({...r,connectionId:d.connection_id})));if(reports.length>20000)throw new ReportingError('表示件数が多いため期間を短くしてください。');
   return json({ready:!!env.CONNECTOR_KEY,connections:connections.map(({credential,business_id,busy_id,...c})=>({...c,coverage:stored.filter(d=>d.connection_id===c.id).map(({day,collected_at})=>({day,collected_at}))})),reports});
  }
  if(r.method!=='POST')return json({error:'この操作は使用できません。'},405);
  const raw=await r.text();if(raw.length>55000)throw new ReportingError('入力が大きすぎます。');const b=JSON.parse(raw);
  if(b.action==='connect'){
   if(user.role!=='owner')return json({error:'接続キーは全体管理者が設定します。'},403);
   if(!env.CONNECTOR_KEY)throw new ReportingError('接続情報の暗号化設定が必要です。');
   const v=validateCredentials(b.provider,b.externalId,b.credentials),existing=await env.DB.prepare('SELECT * FROM ad_reporting_connections WHERE provider=? AND external_id=?').bind(v.provider,v.id).first<Stored>();
   if(existing&&existing.business_id!==scope)throw new ReportingError('この広告アカウントは別の事業に登録されています。事業の割当を確認してください。');
   const account=await createReportingClient(v.provider,v.id,v.credentials).account(),id=existing?.id??crypto.randomUUID(),encrypted=await seal(env,scope,'ad-reporting:'+id,JSON.stringify(v.credentials)),now=new Date().toISOString();
   if(existing){
    if(existing.currency!==account.currency||existing.timezone!==account.timezone)throw new ReportingError('保存済みの通貨・時間帯と一致しません。過去実績と混在させないため更新を止めました。');
    const changed=await env.DB.prepare('UPDATE ad_reporting_connections SET credential=?,name=?,last_error=NULL WHERE id=? AND business_id=? AND (busy_until IS NULL OR busy_until<?)').bind(encrypted,account.name,id,scope,now).run();if(!changed.meta.changes)return json({error:'取得中です。完了後に接続を更新してください。'},409);
   }else{
    const count=await env.DB.prepare('SELECT count(*) n FROM ad_reporting_connections WHERE business_id=?').bind(scope).first<{n:number}>();if((count?.n??0)>=20)throw new ReportingError('接続は1事業20件までです。');
    await env.DB.prepare('INSERT INTO ad_reporting_connections(id,business_id,provider,external_id,name,currency,timezone,credential,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,scope,v.provider,v.id,account.name,account.currency,account.timezone,encrypted,now).run();
   }
   return json({message:'広告アカウントの認証を確認しました。取得期間を選び「今すぐ取得」を押してください。',id});
  }
  if(b.action!=='sync'||typeof b.id!=='string')throw new ReportingError('操作を確認してください。');range(b.start,b.end,7);
  const a=await env.DB.prepare('SELECT * FROM ad_reporting_connections WHERE id=? AND business_id=?').bind(b.id,scope).first<Stored>();if(!a)return json({error:'この事業の接続が見つかりません。'},404);
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:a.timezone});if(b.end>=today)throw new ReportingError('取得できるのは広告アカウントの時間帯で昨日までです。');
  const lock=crypto.randomUUID(),now=new Date().toISOString(),until=new Date(Date.now()+180000).toISOString();
  const claim=await env.DB.prepare('UPDATE ad_reporting_connections SET busy_id=?,busy_until=? WHERE id=? AND credential=? AND (busy_until IS NULL OR busy_until<?)').bind(lock,until,a.id,a.credential,now).run();if(!claim.meta.changes)return json({error:'この接続は取得中、またはキーが更新されました。少し待って再取得してください。'},409);
  try{
   const c=JSON.parse(await seal(env,scope,'ad-reporting:'+a.id,a.credential,true)),client=createReportingClient(a.provider,a.external_id,c),account=await client.account();
   if(account.currency!==a.currency||account.timezone!==a.timezone)throw new ReportingError('媒体の通貨・時間帯が変わっています。設定を確認してください。');
   const rows=await client.reports(account,b.start,b.end),at=new Date().toISOString();
   if(at>=until)throw new ReportingError('取得時間の上限に達しました。期間を短くしてください。');
   // All days and freshness metadata commit atomically. Each statement is fenced by the lease.
   await env.DB.batch([...daysIn(b.start,b.end).map(day=>env.DB.prepare('INSERT INTO ad_reporting_days(connection_id,day,data,collected_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM ad_reporting_connections WHERE id=? AND busy_id=?) ON CONFLICT(connection_id,day) DO UPDATE SET data=excluded.data,collected_at=excluded.collected_at').bind(a.id,day,JSON.stringify(rows.filter(r=>r.day===day)),at,a.id,lock)),env.DB.prepare('UPDATE ad_reporting_connections SET last_sync=?,last_error=NULL,busy_id=NULL,busy_until=NULL WHERE id=? AND busy_id=?').bind(at,a.id,lock)]);
   const saved=await env.DB.prepare('SELECT last_sync FROM ad_reporting_connections WHERE id=?').bind(a.id).first<{last_sync:string}>();if(saved?.last_sync!==at)throw new ReportingError('別の取得が先に完了しました。画面を更新してください。');
   return json({message:`${b.start}〜${b.end}の${rows.length}行を保存しました。`,rows:rows.length});
  }catch(e){const message=safeError(e);await env.DB.prepare('UPDATE ad_reporting_connections SET last_error=?,busy_id=NULL,busy_until=NULL WHERE id=? AND busy_id=?').bind(message,a.id,lock).run();return json({error:message},400);}
 }catch(e){return json({error:safeError(e)},400);}
}
