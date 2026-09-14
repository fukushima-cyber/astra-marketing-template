import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {defaultPolicy,validatePolicy,type JobData} from '../lib/autonomy/model.ts';
import {settings,policy} from './autonomy-store.ts';
import {seal} from './native.ts';
const json=(b:unknown,status=200)=>Response.json(b,{status});
export async function autonomy(r:Request,env:Env,user:Identity,scope:string){
 if(!can(user,scope,'autonomy'))return json({error:'自律運用の閲覧権限がありません。'},403);
 try{const s=await settings(env,scope);if(r.method==='GET'){
 const jobs=(await env.DB.prepare('SELECT id,status,data,created_at,updated_at FROM autonomy_jobs WHERE business_id=? ORDER BY created_at DESC LIMIT 30').bind(scope).all<{id:string;status:string;data:string;created_at:string;updated_at:string}>()).results.map(({data,...j})=>{const d=JSON.parse(data) as JobData;return{...j,summary:d.summary,question:d.question,nextAt:d.nextAt,steps:d.steps,calls:d.calls,tokens:d.tokens,model:d.model};});
 const actions=(await env.DB.prepare('SELECT a.id,a.job_id,a.name,a.status,a.result,a.created_at FROM autonomy_actions a JOIN autonomy_jobs j ON j.id=a.job_id WHERE j.business_id=? ORDER BY a.created_at DESC LIMIT 100').bind(scope).all<{name:string;status:string;result:string}>()).results.map(({result,...a})=>({...a,result:a.name==='model'&&a.status==='done'?'モデルの応答を保存しました。':result.slice(0,12000)}));
 const accounts=(await env.DB.prepare('SELECT id,name,currency,policy FROM ad_accounts WHERE business_id=?').bind(scope).all<{policy:string}>()).results.map(a=>({...a,policy:JSON.parse(a.policy)}));
 return json({policy:s?policy(s):defaultPolicy,version:s?.version??0,nextAt:s?.next_at??null,jobs,actions,accounts,model:s?.model||env.ASTRA_MODEL||'gpt-6-astra',modelReady:!!(s?.credential||env.ASTRA_OPENAI_KEY)&&!!(s?.model||env.ASTRA_MODEL),storageReady:!!env.CONNECTOR_KEY,runnerReady:!!env.ASTRA_LOOP});
 }
 if(r.method!=='POST')return json({error:'操作できません。'},405);if(user.role!=='owner')return json({error:'任せる範囲と開始・停止は全体管理者が設定します。'},403);
 const raw=await r.text();if(raw.length>20000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw);if(!env.ASTRA_LOOP)throw new Error('自律運用の実行基盤が未接続です。');
 if(b.action==='save'){
 validatePolicy(b.policy);if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!==(s?.version??0))return json({error:'設定が更新されています。再取得してください。'},409);
 const ids=(await env.DB.prepare('SELECT id FROM ad_accounts WHERE business_id=?').bind(scope).all<{id:string}>()).results.map(a=>a.id);if(b.policy.adAccounts.some((id:string)=>!ids.includes(id)))throw new Error('広告アカウントを確認してください。');
 if(b.policy.enabled&&(!(s?.credential||env.ASTRA_OPENAI_KEY)||!(s?.model||env.ASTRA_MODEL)))throw new Error('モデルの接続を先に設定してください。');
 const next=b.policy.enabled?Date.now()+1000:null,now=new Date().toISOString();
 if(!s)await env.DB.prepare('INSERT INTO autonomy_settings(business_id,owner_id,version,policy,next_at,updated_at) VALUES(?,?,?,?,?,?)').bind(scope,user.id,1,JSON.stringify(b.policy),next,now).run();
 else{const changed=await env.DB.prepare('UPDATE autonomy_settings SET policy=?,version=version+1,next_at=?,updated_at=? WHERE business_id=? AND version=?').bind(JSON.stringify(b.policy),next,now,scope,s.version).run();if(!changed.meta.changes)return json({error:'設定が更新されています。'},409);}
 }else if(b.action==='model'){
 if(typeof b.model!=='string'||!/^[-a-zA-Z0-9._:]+$/.test(b.model)||b.model.length>100||typeof b.key!=='string'||!b.key.trim()||b.key.length>10000)throw new Error('モデル名と接続キーを確認してください。');
 const response=await fetch('https://api.openai.com/v1/models/'+encodeURIComponent(b.model),{headers:{Authorization:'Bearer '+b.key.trim()},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('モデルへのアクセスを確認できませんでした。名前とキーを確認してください。');
 const encrypted=await seal(env,scope,'autonomy-model',b.key.trim()),now=new Date().toISOString();
 if(!s)await env.DB.prepare('INSERT INTO autonomy_settings(business_id,owner_id,version,policy,model,credential,updated_at) VALUES(?,?,?,?,?,?,?)').bind(scope,user.id,1,JSON.stringify(defaultPolicy),b.model,encrypted,now).run();else await env.DB.prepare('UPDATE autonomy_settings SET model=?,credential=?,version=version+1,updated_at=? WHERE business_id=?').bind(b.model,encrypted,now,scope).run();
 }else if(b.action==='resume'){
 if(!s||!policy(s).enabled)throw new Error('任せる範囲を設定して有効にしてください。');if(typeof b.message!=='string'||b.message.length>4000)throw new Error('追加の指示を確認してください。');const p=policy(s);if(b.message.trim())p.purpose+='\n追加の指示：'+b.message.trim();validatePolicy(p);await env.DB.prepare('UPDATE autonomy_settings SET policy=?,version=version+1,next_at=? WHERE business_id=? AND version=?').bind(JSON.stringify(p),Date.now()+1000,scope,s.version).run();
 }else if(b.action==='stop'){if(s){const p=policy(s);p.enabled=false;await env.DB.prepare('UPDATE autonomy_settings SET policy=?,version=version+1,next_at=NULL WHERE business_id=?').bind(JSON.stringify(p),scope).run();}}
 else throw new Error('操作を確認してください。');
 await env.ASTRA_LOOP.getByName(scope).wake(scope);return json({message:b.action==='stop'?'自律運用を停止しました。開始済みの通信は結果を履歴で確認してください。':b.action==='model'?'モデルの接続を保存しました。':b.action==='save'&&!b.policy.enabled?'設定を保存しました。自律運用は停止中です。':'設定を保存し、次の仕事を予約しました。'});
 }catch(e){return json({error:e instanceof Error?e.message:'処理できませんでした。'},400);}
}
