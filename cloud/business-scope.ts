import type {Env} from './types.ts';
import {isBusinessKind,businessColumns,decodeBusiness,validChoices,revenueModelNames,acquisitionChannelNames,type BusinessSummary} from '../lib/business.ts';
export const documentId=(businessId:string,id:string)=>businessId==='default'?id:`${businessId}:${id}`;
export async function resolveBusiness(r:Request,env:Env){const id=r.headers.get('X-Astra-Business')??new URL(r.url).searchParams.get('businessId')??'default';if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))return null;return await env.DB.prepare(`SELECT ${businessColumns},company_id AS companyId FROM businesses WHERE id=? AND archived_at IS NULL`).bind(id).first<BusinessSummary&{companyId:string}>();}
export async function businesses(r:Request,env:Env){
 if(r.method==='GET')return Response.json({businesses:(await env.DB.prepare(`SELECT ${businessColumns},created_at FROM businesses ORDER BY archived_at IS NOT NULL,created_at,id`).all<BusinessSummary>()).results.map(decodeBusiness)});
 if(r.method!=='POST')return Response.json({error:'操作できません。'},{status:405});
 let b;try{const text=await r.text();if(text.length>2000)throw new Error();b=JSON.parse(text);}catch{return Response.json({error:'入力を確認してください。'},{status:400});}
 const actions=['create','rename','configure','archive','restore','delete'];
 if(!b||!actions.includes(b.action)||typeof b.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.id))return Response.json({error:'操作する事業を確認してください。'},{status:400});
 if(['create','rename','configure'].includes(b.action)&&(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)||b.action==='create'&&!isBusinessKind(b.kind??'content'))return Response.json({error:'事業名または事業種別を確認してください。'},{status:400});
 if(['create','configure'].includes(b.action)){
  if(!validChoices(b.revenueModels??[],revenueModelNames)||!validChoices(b.acquisitionChannels??[],acquisitionChannelNames))return Response.json({error:'収益方法と集客チャネルを確認してください。'},{status:400});
  if(b.action==='configure'&&(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||b.revenueModels===undefined||b.acquisitionChannels===undefined))return Response.json({error:'設定の版と選択内容を確認してください。'},{status:400});
 }
 if(b.action==='create'){
  const count=await env.DB.prepare('SELECT count(*) AS n FROM businesses').first<{n:number}>();if((count?.n??0)>=100)return Response.json({error:'アーカイブを含め、事業は100件までです。'},{status:400});
  const result=await env.DB.prepare('INSERT OR IGNORE INTO businesses(id,name,kind,created_at,revenue_models,acquisition_channels) VALUES(?,?,?,?,?,?)').bind(b.id,b.name.trim(),b.kind??'content',new Date().toISOString(),JSON.stringify(b.revenueModels??(b.kind?[b.kind]:[])),JSON.stringify(b.acquisitionChannels??[])).run();if(!result.meta.changes)return Response.json({error:'同じ識別子の事業がすでにあります。'},{status:409});
 }else{
  const row=await env.DB.prepare(`SELECT ${businessColumns} FROM businesses WHERE id=?`).bind(b.id).first<BusinessSummary>();if(!row)return Response.json({error:'事業が見つかりません。'},{status:404});
  if(b.action==='configure'){
   if(row.archivedAt)return Response.json({error:'アーカイブ済みの事業は復元してから設定してください。'},{status:409});
   const result=await env.DB.prepare('UPDATE businesses SET name=?,revenue_models=?,acquisition_channels=?,profile_version=profile_version+1 WHERE id=? AND profile_version=? AND archived_at IS NULL').bind(b.name.trim(),JSON.stringify(b.revenueModels),JSON.stringify(b.acquisitionChannels),b.id,b.expectedVersion).run();
   if(!result.meta.changes)return Response.json({error:'他の更新があります。設定を開き直してください。'},{status:409});
  }
  if(b.action==='rename'){if(row.archivedAt)return Response.json({error:'アーカイブ済みの事業は、復元してから名前を変更してください。'},{status:409});await env.DB.prepare('UPDATE businesses SET name=?,profile_version=profile_version+1 WHERE id=?').bind(b.name.trim(),b.id).run();}
  if(b.action==='archive'&&!row.archivedAt)await env.DB.batch([env.DB.prepare('UPDATE businesses SET archived_at=? WHERE id=?').bind(new Date().toISOString(),b.id),env.DB.prepare('UPDATE autonomy_settings SET next_at=NULL,lease=NULL,lease_until=NULL WHERE business_id=?').bind(b.id)]);
  if(b.action==='restore'){if(row.archivedAt)await env.DB.prepare('UPDATE businesses SET archived_at=NULL WHERE id=?').bind(b.id).run();}
  if(b.action==='delete'){
   if(!row.archivedAt)return Response.json({error:'完全に削除する前にアーカイブしてください。'},{status:409});
   if(typeof b.confirmName!=='string'||b.confirmName!==row.name)return Response.json({error:'確認用の名前が一致しません。'},{status:400});
   if(['default','affiliate'].includes(row.id))return Response.json({error:'初期事業は完全削除できません。アーカイブして非表示にできます。'},{status:409});
   const prefix=row.id+':%',invitation='%'+row.id+'%';
   const used=await env.DB.prepare("SELECT (SELECT count(*) FROM access_grants WHERE business_id=?)+(SELECT count(*) FROM analytics_imports WHERE business_id=?)+(SELECT count(*) FROM analytics_rows WHERE business_id=?)+(SELECT count(*) FROM native_connections WHERE business_id=?)+(SELECT count(*) FROM native_snapshots WHERE business_id=?)+(SELECT count(*) FROM ad_reporting_connections WHERE business_id=?)+(SELECT count(*) FROM ad_accounts WHERE business_id=?)+(SELECT count(*) FROM ad_changes WHERE business_id=?)+(SELECT count(*) FROM autonomy_settings WHERE business_id=?)+(SELECT count(*) FROM autonomy_jobs WHERE business_id=?)+(SELECT count(*) FROM documents WHERE id LIKE ?)+(SELECT count(*) FROM invitations WHERE grants LIKE ?) AS n").bind(row.id,row.id,row.id,row.id,row.id,row.id,row.id,row.id,row.id,row.id,prefix,invitation).first<{n:number}>();
   if((used?.n??0)>0)return Response.json({error:'実績・設定・権限などの関連データがあるため完全削除できません。アーカイブしたまま保管してください。'},{status:409});
   await env.DB.prepare('DELETE FROM businesses WHERE id=?').bind(row.id).run();return Response.json({id:row.id,deleted:true});
  }
 }
 const row=await env.DB.prepare(`SELECT ${businessColumns} FROM businesses WHERE id=?`).bind(b.id).first<BusinessSummary>();return Response.json(row?decodeBusiness(row):{error:'事業が見つかりません。'},{status:row?200:404});
}
