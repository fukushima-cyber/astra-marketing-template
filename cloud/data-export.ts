import type {Env} from './types.ts';
import type {Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
const documentNames=['business','drafts','native-links','measurement-policy','journey-sources','change-timeline','improvements','whiteboard','agent-skills','commerce'];
export async function dataExport(r:Request,env:Env,user:Identity,scope:string){
 if(user.role!=='owner')return Response.json({error:'実績の控えは全体管理者だけが取得できます。'},{status:403});
 if(r.method!=='GET')return Response.json({error:'読取専用の操作です。'},{status:405});
 const queries:Record<string,{sql:string;args:unknown[]}>={};
 queries.documents={sql:'SELECT * FROM documents WHERE id IN (SELECT value FROM json_each(?))',args:[JSON.stringify(documentNames.map(id=>documentId(scope,id)))]};
 for(const table of ['journey_events','analytics_rows','analytics_imports','native_snapshots','ad_changes','autonomy_jobs'])queries[table]={sql:'SELECT * FROM '+table+' WHERE business_id=?',args:[scope]};
 queries.native_connections={sql:'SELECT id,business_id,provider,label,external_id,targets,enabled,created_at,last_attempt,last_success,last_error FROM native_connections WHERE business_id=?',args:[scope]};
 queries.ad_accounts={sql:'SELECT id,business_id,provider,external_id,name,currency,timezone,policy,version,last_sync,created_at FROM ad_accounts WHERE business_id=?',args:[scope]};
 queries.ad_reporting_connections={sql:'SELECT id,business_id,provider,external_id,name,currency,timezone,created_at,last_sync,last_error FROM ad_reporting_connections WHERE business_id=?',args:[scope]};
 for(const table of ['ad_entities','ad_reports'])queries[table]={sql:'SELECT d.* FROM '+table+' d JOIN ad_accounts c ON c.id=d.account_id WHERE c.business_id=?',args:[scope]};
 queries.ad_reporting_days={sql:'SELECT d.* FROM ad_reporting_days d JOIN ad_reporting_connections c ON c.id=d.connection_id WHERE c.business_id=?',args:[scope]};
 queries.autonomy_actions={sql:'SELECT a.* FROM autonomy_actions a JOIN autonomy_jobs j ON j.id=a.job_id WHERE j.business_id=?',args:[scope]};
 queries.autonomy_settings={sql:'SELECT business_id,version,policy,model,updated_at FROM autonomy_settings WHERE business_id=?',args:[scope]};
 try{
  const data:Record<string,unknown[]>={};let bytes=0;const startedAt=new Date().toISOString();
  for(const [name,q] of Object.entries(queries)){const rows=(await env.DB.prepare(q.sql+' LIMIT 10001').bind(...q.args).all()).results;if(rows.length>10000)throw new Error('too-large');bytes+=new TextEncoder().encode(JSON.stringify(rows)).length;if(bytes>8000000)throw new Error('too-large');data[name]=rows;}
  return Response.json({format:'astra-business-data-copy',version:1,businessId:scope,startedAt,finishedAt:new Date().toISOString(),note:'保存済み実績と設定の読取専用コピー。認証キー、ログイン情報は含まない。自動復元用の完全なDBバックアップではない。読取中の更新は含まれる場合がある。',counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),data},{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="astra-business-data-'+new Date().toISOString().slice(0,10)+'.json"','X-Content-Type-Options':'nosniff'}});
 }catch{return Response.json({error:'実績の控えを取得できませんでした。件数が大きい場合は管理者のSupabaseバックアップを使用してください。データは変更していません。'},{status:503});}
}

