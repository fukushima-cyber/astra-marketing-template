import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {seal} from './native.ts';
import {digest,readDocument} from './storage.ts';
import {documentId} from './business-scope.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {emptyState} from '../lib/improvements/model.ts';
import {defaultPolicy,validatePolicy,checkChange,offset,type Policy,type Entity,type Change} from '../lib/ads/model.ts';
import {validDate} from '../lib/analytics/model.ts';
import * as provider from './meta-ads.ts';
type Account={id:string;business_id:string;external_id:string;name:string;currency:string;timezone:string;credential:string;policy:string;version:number;busy_id:string|null;last_sync:string|null};
type ChangeRow={id:string;account_id:string;business_id:string;status:string;data:string;signature:string;created_at:string;attempted_at:string|null;message:string};
const json=(v:unknown,status=200)=>Response.json(v,{status});
const str=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length<=max;
const date=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export async function ads(r:Request,env:Env,user:Identity,scope:string,autonomous=false){
 if(!can(user,scope,'ads',r.method!=='GET'))return json({error:'この事業の広告運用権限がありません。'},403);
 try{
 const accounts=(await env.DB.prepare('SELECT * FROM ad_accounts WHERE business_id=? ORDER BY created_at').bind(scope).all<Account>()).results;
 const business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 if(r.method==='GET'){
 const q=new URL(r.url).searchParams,start=q.get('start')??date().slice(0,7)+'-01',end=q.get('end')??date();if(!validDate(start)||!validDate(end)||start>end)throw new Error('表示期間を確認してください。');
 const accountId=q.get('accountId')??accounts[0]?.id,selected=accounts.find(a=>a.id===accountId);if(accountId&&!selected)return json({error:'この事業の広告接続が見つかりません。'},404);
 const objects=selected?(await env.DB.prepare('SELECT data FROM ad_entities WHERE account_id=?').bind(selected.id).all<{data:string}>()).results.map(r=>JSON.parse(r.data)):[];
 const rows=selected?(await env.DB.prepare('SELECT data FROM ad_reports WHERE account_id=? AND day>=? AND day<=? ORDER BY day,ad_id LIMIT 10001').bind(selected.id,start,end).all<{data:string}>()).results:[];if(rows.length>10000)throw new Error('実績が多いため表示期間を短くしてください。');
 const changes=(await env.DB.prepare('SELECT * FROM ad_changes WHERE business_id=? ORDER BY created_at DESC LIMIT 200').bind(scope).all<ChangeRow>()).results.map(c=>({...c,data:JSON.parse(c.data)}));
 const cases=can(user,scope,'improvements')?(await readDocument(env.DB,documentId(scope,'improvements'),emptyState)).data.cases.map(c=>({id:c.id,title:c.title,funnelId:c.funnelId})):[];
 return json({accounts:accounts.map(({credential,...a})=>({...a,policy:JSON.parse(a.policy)})),selectedId:selected?.id??'',entities:objects,reports:rows.map(r=>JSON.parse(r.data)),changes,funnels:business.funnels??[],cases,ready:!!env.CONNECTOR_KEY});
 }
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 const raw=await r.text();if(raw.length>25000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw);if(!b||!str(b.requestId,100)||!b.requestId)throw new Error('操作IDを確認してください。');
 if(b.action==='connect'){
 if(user.role!=='owner')return json({error:'接続は全体管理者が設定します。'},403);
 if(!str(b.token,10000)||!b.token.trim()||!str(b.externalId,50)||!/^act_\d+$/.test(b.externalId))throw new Error('広告アカウントIDと接続キーを確認してください。');
 const a=await provider.account(b.token.trim(),b.externalId),existing=accounts.find(a=>a.external_id===b.externalId);
 if(existing?.busy_id)throw new Error('変更結果を確認してから接続キーを更新してください。');
 const id=existing?.id??crypto.randomUUID(),credential=await seal(env,scope,'ads:'+id,b.token.trim());
 if(existing){const updated=await env.DB.prepare('UPDATE ad_accounts SET credential=?,name=?,currency=?,timezone=?,version=version+1 WHERE id=? AND business_id=? AND busy_id IS NULL').bind(credential,String(a.name),a.currency,a.timezone_name,id,scope).run();if(!updated.meta.changes)throw new Error('広告変更中のため接続を更新できません。');}
 else{const another=await env.DB.prepare('SELECT id FROM ad_accounts WHERE provider=? AND external_id=?').bind('meta',b.externalId).first();if(another)throw new Error('この広告アカウントは登録済みです。事業の割当を確認してください。');if(accounts.length>=10)throw new Error('接続は1事業10件までです。');await env.DB.prepare('INSERT INTO ad_accounts(id,business_id,provider,external_id,name,currency,timezone,credential,policy,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,scope,'meta',b.externalId,String(a.name),a.currency,a.timezone_name,credential,JSON.stringify(defaultPolicy),new Date().toISOString()).run();}
 return json({message:'Meta広告に接続しました。広告の一覧と数字を取得してください。',accountId:id});
 }
 const a=accounts.find(a=>a.id===b.accountId);if(!a)return json({error:'この事業の広告接続が見つかりません。'},404);
 const p=JSON.parse(a.policy) as Policy,token=()=>seal(env,scope,'ads:'+a.id,a.credential,true);
 if(b.action==='policy'){
 if(user.role!=='owner')return json({error:'実行範囲は全体管理者が設定します。'},403);validatePolicy(b.policy);
 const result=await env.DB.prepare('UPDATE ad_accounts SET policy=?,version=version+1 WHERE id=? AND business_id=? AND version=? AND busy_id IS NULL').bind(JSON.stringify(b.policy),a.id,scope,b.expectedVersion).run();if(!result.meta.changes)return json({error:'変更中または設定が更新されています。再取得してください。'},409);
 return json({message:'実行範囲を保存しました。既存の変更案は新しい設定で作り直してください。'});
 }
 if(b.action==='sync'){
 if(!validDate(b.start)||!validDate(b.end)||b.start>b.end||(Date.parse(b.end)-Date.parse(b.start))/86400000>89)throw new Error('取得期間は90日以内で指定してください。');
 const t=await token(),remote=await provider.account(t,a.external_id);if(remote.currency!==a.currency||remote.timezone_name!==a.timezone)throw new Error('アカウント設定が変わりました。接続を更新してください。');
 const objects=await provider.entities(t,a.external_id),rs=await provider.reports(t,a.external_id,b.start,b.end),now=new Date().toISOString();
 const old=(await env.DB.prepare('SELECT data FROM ad_entities WHERE account_id=?').bind(a.id).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Entity);
 const statements=[env.DB.prepare('DELETE FROM ad_entities WHERE account_id=?').bind(a.id),...objects.map(o=>env.DB.prepare('INSERT INTO ad_entities(account_id,id,level,data) VALUES(?,?,?,?)').bind(a.id,o.id,o.level,JSON.stringify({...o,funnelId:old.find(v=>v.id===o.id)?.funnelId??''}))),env.DB.prepare('DELETE FROM ad_reports WHERE account_id=? AND day>=? AND day<=?').bind(a.id,b.start,b.end),...rs.map(row=>env.DB.prepare('INSERT INTO ad_reports(account_id,ad_id,day,data,collected_at) VALUES(?,?,?,?,?)').bind(a.id,row.adId,row.date,JSON.stringify(row),now)),env.DB.prepare('UPDATE ad_accounts SET last_sync=? WHERE id=?').bind(now,a.id)];
 if(statements.length>1500)throw new Error('取得件数が多いため期間を短くしてください。');await env.DB.batch(statements);return json({message:`広告${objects.length}件、日別実績${rs.length}件を取得しました。`});
 }
 if(b.action==='mapping'){
 const row=await env.DB.prepare('SELECT data FROM ad_entities WHERE account_id=? AND id=?').bind(a.id,b.entityId).first<{data:string}>();if(!row)throw new Error('広告を選び直してください。');const o=JSON.parse(row.data) as Entity;if(o.level!=='campaign'||!str(b.funnelId)||b.funnelId&&!business.funnels?.some(f=>f.id===b.funnelId&&f.source==='ads'))throw new Error('広告流入のファネルを選んでください。');o.funnelId=b.funnelId;const changed=await env.DB.prepare('UPDATE ad_entities SET data=? WHERE account_id=? AND id=? AND data=?').bind(JSON.stringify(o),a.id,o.id,row.data).run();if(!changed.meta.changes)return json({error:'一覧が更新されました。再取得してください。'},409);return json({message:'広告とファネルを関連付けました。売上や登録数は自動で合算しません。'});
 }
 if(b.action==='propose'){
 const previous=await env.DB.prepare('SELECT signature FROM ad_changes WHERE id=?').bind(b.requestId).first<{signature:string}>(),signature=await digest(JSON.stringify(b));if(previous){if(previous.signature!==signature)return json({error:'操作IDが競合しています。'},409);return json({message:'変更案は保存済みです。'});}
 if(!['campaign','adset','ad'].includes(b.level)||!str(b.entityId,50)||!['status','daily_budget'].includes(b.field)||!str(b.reason,4000)||!b.reason.trim()||!str(b.caseId,100))throw new Error('変更内容と理由を記入してください。');
 if(b.caseId){if(!can(user,scope,'improvements'))return json({error:'改善案件の閲覧権限が必要です。'},403);if(!(await readDocument(env.DB,documentId(scope,'improvements'),emptyState)).data.cases.some(c=>c.id===b.caseId))throw new Error('改善案件が見つかりません。');}
 const t=await token(),o=await provider.readEntity(t,a.external_id,b.entityId,b.level);const unit=offset(a.currency);if(b.field==='status'&&typeof b.after!=='string'||b.field==='daily_budget'&&typeof b.after!=='number')throw new Error('変更後の値を確認してください。');const after=b.field==='daily_budget'?Math.round(Number(b.after)*(unit??1)):b.after;
 if(b.field==='daily_budget'&&(!unit||!Number.isFinite(Number(b.after))||Math.abs(Number(b.after)*unit-after)>1e-6))throw new Error('予算の金額と通貨を確認してください。');
 const change:Change={entity:o,field:b.field,before:b.field==='status'?o.status:o.dailyBudget??0,after,reason:b.reason,caseId:b.caseId,policyVersion:a.version,currency:a.currency};
 checkChange(change,o,{...p,enabled:true},a.currency);
 await env.DB.prepare('INSERT INTO ad_changes(id,account_id,business_id,signature,data,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(b.requestId,a.id,scope,signature,JSON.stringify(change),'draft',user.id,new Date().toISOString()).run();return json({message:'変更案を保存しました。まだMeta広告には反映していません。'});
 }
 const row=await env.DB.prepare('SELECT * FROM ad_changes WHERE id=? AND account_id=? AND business_id=?').bind(b.changeId,a.id,scope).first<ChangeRow>();if(!row)throw new Error('変更案が見つかりません。');const c=JSON.parse(row.data) as Change;
 if(b.action==='approve'||b.action==='cancel'){
 const expected=b.action==='approve'?['draft']:['draft','approved'];if(!expected.includes(row.status))throw new Error('変更案の状態を再確認してください。');if(b.action==='approve'&&c.policyVersion!==a.version)throw new Error('実行範囲が変更されています。案を作り直してください。');
 const changed=await env.DB.prepare('UPDATE ad_changes SET status=?,approved_by=? WHERE id=? AND status=?').bind(b.action==='approve'?'approved':'cancelled',b.action==='approve'?user.id:null,row.id,row.status).run();if(!changed.meta.changes)return json({error:'別の操作で更新されています。'},409);return json({message:b.action==='approve'?'変更内容を承認しました。実行ボタンでMetaに反映します。':'変更案を取り消しました。'});
 }
 const finish=async(status:string,message:string)=>{await env.DB.batch([env.DB.prepare('UPDATE ad_changes SET status=?,message=?,finished_at=? WHERE id=?').bind(status,message,new Date().toISOString(),row.id),...(status==='uncertain'?[]:[env.DB.prepare('UPDATE ad_accounts SET busy_id=NULL WHERE id=? AND busy_id=?').bind(a.id,row.id)])]);};
 if(b.action==='reconcile'){
 if(!['sending','uncertain'].includes(row.status)||a.busy_id!==row.id)throw new Error('結果確認の対象ではありません。');if(row.attempted_at&&Date.now()-Date.parse(row.attempted_at)<120000)throw new Error('実行中の可能性があります。2分後に再確認してください。');const current=await provider.readEntity(await token(),a.external_id,c.entity.id,c.entity.level),value=c.field==='status'?current.status:current.dailyBudget;
 if(value===c.after){await finish('succeeded','現在値が変更案と一致することを確認しました。');return json({message:'変更後の値を確認しました。'});}
 if(b.acknowledge!==true)return json({message:'現在値が変更案と一致しません。広告側を確認し、未反映として記録する操作を選んでください。',needsAcknowledgement:true});
 await finish('failed','操作者が現在値を確認し、未反映として記録しました。自動再送はしていません。');return json({message:'確認結果を保存しました。再実行する場合は新しい変更案を作成してください。'});
 }
 if(b.action!=='execute')throw new Error('操作を確認してください。');
 if(c.policyVersion!==a.version)throw new Error('実行範囲が変わりました。変更案を作り直してください。');
 if(autonomous){const operation=c.field==='daily_budget'?'budget':c.after==='PAUSED'?'pause':'resume';if(!p.autonomousOperations?.includes(operation)||!p.enabled)throw new Error('この広告操作はAstraに任されていません。');if(row.status==='draft'){const approved=await env.DB.prepare("UPDATE ad_changes SET status='approved',approved_by=? WHERE id=? AND status='draft'").bind('astra:'+user.id,row.id).run();if(!approved.meta.changes)throw new Error('変更案の状態が更新されました。');row.status='approved';}}if(row.status!=='approved')throw new Error('承認済みの変更案だけ実行できます。');if(c.policyVersion!==a.version)throw new Error('実行範囲が変わりました。変更案を作り直してください。');if(!p.enabled)throw new Error('外部変更は停止中です。');
 const attemptToken=crypto.randomUUID(),now=new Date().toISOString(),dayStart=new Date(date()+'T00:00:00+09:00').toISOString();
 await env.DB.batch([
 env.DB.prepare("UPDATE ad_accounts SET busy_id=? WHERE id=? AND version=? AND busy_id IS NULL AND EXISTS(SELECT 1 FROM ad_changes WHERE id=? AND status='approved') AND (SELECT COUNT(*) FROM ad_changes WHERE account_id=? AND attempted_at>=?)<?").bind(row.id,a.id,a.version,row.id,a.id,dayStart,p.maxOperations),
 env.DB.prepare("UPDATE ad_changes SET status='sending',attempted_at=?,attempt_token=? WHERE id=? AND status='approved' AND EXISTS(SELECT 1 FROM ad_accounts WHERE id=? AND busy_id=?)").bind(now,attemptToken,row.id,a.id,row.id)
 ]);
 const claimed=await env.DB.prepare('SELECT status,attempt_token FROM ad_changes WHERE id=?').bind(row.id).first<{status:string;attempt_token:string}>();if(claimed?.status!=='sending'||claimed.attempt_token!==attemptToken)return json({error:'実行中、または本日の操作上限に達しています。'},409);
 let sent=false;
 try{
 const t=await token(),remote=await provider.account(t,a.external_id);if(remote.currency!==a.currency)throw new Error('通貨設定が変わりました。');const current=await provider.readEntity(t,a.external_id,c.entity.id,c.entity.level);checkChange(c,current,p,a.currency);
 if(c.field==='daily_budget'&&current.level==='adset'){const parent=await provider.readEntity(t,a.external_id,current.campaignId,'campaign');if(parent.dailyBudget||parent.lifetimeBudget)throw new Error('キャンペーンで予算管理しています。キャンペーンの変更案を作成してください。');}
 sent=true;await provider.update(t,c.entity.id,c.field,c.after);const result=await provider.readEntity(t,a.external_id,c.entity.id,c.entity.level);if((c.field==='status'?result.status:result.dailyBudget)!==c.after)throw new provider.MetaError('現在値の一致を確認できません。時間を置いて結果を確認してください。',true);
 await finish('succeeded','Metaの変更後の値を再取得して一致を確認しました。');return json({message:'Meta広告への反映を確認しました。配信審査や上位の停止状態は別途、一覧を更新して確認してください。'});
 }catch(e){const uncertain=sent&&(!(e instanceof provider.MetaError)||e.uncertain);const message=e instanceof Error?e.message:'処理できませんでした。';await finish(uncertain?'uncertain':'failed',message);return json({message,status:uncertain?'uncertain':'failed'});}
 }catch(e){return json({error:e instanceof SyntaxError?'入力形式を確認してください。':e instanceof Error?e.message:'広告を取得できませんでした。'},400);}
}
