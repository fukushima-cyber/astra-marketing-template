import type {Env} from './types.ts';
import {settings,policy,ownerIdentity,finishJob,type Job} from './autonomy-store.ts';
import type {JobData} from '../lib/autonomy/model.ts';
import {modelStep} from './autonomy-model.ts';
import {tools,performTool} from './autonomy-tools.ts';
import {readDocument,digest} from './storage.ts';
import {documentId} from './business-scope.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
const iso=()=>new Date().toISOString();
export async function tick(env:Env,scope:string):Promise<number|null>{
 const initial=await settings(env,scope);if(!initial)return null;const lease=crypto.randomUUID();
 const acquired=await env.DB.prepare('UPDATE autonomy_settings SET lease=?,lease_until=? WHERE business_id=? AND (lease IS NULL OR lease_until<?)').bind(lease,Date.now()+120000,scope,Date.now()).run();if(!acquired.meta.changes)return Date.now()+125000;
 try{
 const s=(await settings(env,scope))!,p=policy(s);let j=await env.DB.prepare("SELECT * FROM autonomy_jobs WHERE business_id=? AND status='running'").bind(scope).first<Job>();
 if(!p.enabled){if(j){const d=JSON.parse(j.data);d.summary='利用者の設定により中断しました。';await finishJob(env,j,d,'cancelled',null);}return null;}
 try{await ownerIdentity(env,s);}catch{if(j){const d=JSON.parse(j.data);d.summary='任せた管理者の権限を確認できないため停止しました。';await finishJob(env,j,d,'needs_input',null);}await env.DB.prepare('UPDATE autonomy_settings SET next_at=NULL WHERE business_id=? AND version=?').bind(scope,s.version).run();return null;}
 if(p.deadline&&new Date(p.deadline+'T23:59:59+09:00').getTime()<Date.now()){if(j){const d=JSON.parse(j.data);d.summary='目標の期限に達しました。';await finishJob(env,j,d,'needs_input',null);}await env.DB.prepare('UPDATE autonomy_settings SET next_at=NULL WHERE business_id=?').bind(scope).run();return null;}
 if(!j){
 if(s.next_at===null)return null;if(s.next_at>Date.now())return s.next_at;
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}),dayStart=new Date(today+'T00:00:00+09:00').toISOString();
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM autonomy_jobs WHERE business_id=? AND created_at>=?').bind(scope,dayStart).first<{n:number}>();if((count?.n??0)>=p.maxRunsDay){const next=Date.parse(dayStart)+86400000;await env.DB.prepare('UPDATE autonomy_settings SET next_at=? WHERE business_id=?').bind(next,scope).run();return next;}
 const previous=(await env.DB.prepare('SELECT data,status FROM autonomy_jobs WHERE business_id=? ORDER BY created_at DESC LIMIT 5').bind(scope).all<{data:string;status:string}>()).results.map(r=>{const d=JSON.parse(r.data);return{status:r.status,summary:d.summary,question:d.question};});
 const business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 const d:JobData={input:[{role:'user',content:JSON.stringify({purpose:p.purpose,deadline:p.deadline,today:iso(),business:{name:business.name,objective:business.objective,goals:business.goals},delegation:{internal:p.internal,adAccounts:p.adAccounts},previous,note:'必要な期間と情報をツールで選んで調べてください。既存の施策と変更履歴を確認して重複作成を避けてください。'})}],pending:[],calls:0,steps:0,tokens:0,summary:'目標に向けて状況を確認しています。',question:'',nextAt:null,model:s.model||env.ASTRA_MODEL||''};
 j={id:crypto.randomUUID(),business_id:scope,status:'running',policy_version:s.version,data:JSON.stringify(d),created_at:iso()};await env.DB.prepare('INSERT INTO autonomy_jobs(id,business_id,status,policy_version,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(j.id,scope,j.status,j.policy_version,j.data,j.created_at,j.created_at).run();
 }
 const d=JSON.parse(j.data) as JobData;
 if(j.policy_version!==s.version){d.summary='任せる範囲が更新されたため、現在の仕事を中断しました。';await finishJob(env,j,d,'cancelled',Date.now()+1000);return Date.now()+1000;}
 if(d.steps>=p.maxSteps||!d.pending.length&&d.calls>=p.maxModelCalls){d.summary='今回の利用上限に達しました。途中までの実行履歴を保持しています。';await finishJob(env,j,d,'needs_input',null);return null;}
 const call=d.pending[0],name=call?.name??'model',actionId='auto-'+(await digest(j.id+':'+d.steps)).slice(0,48);
 let ledger=await env.DB.prepare('SELECT status,result FROM autonomy_actions WHERE id=?').bind(actionId).first<{status:string;result:string}>();
 if(ledger?.status==='started'&&!call){d.summary='モデル呼び出しが中断され、応答を確認できません。二重課金を避けて自動再送を止めました。';await finishJob(env,j,d,'needs_input',null);return null;}
 if(!ledger){await env.DB.prepare('INSERT INTO autonomy_actions(id,job_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(actionId,j.id,name,'started',iso(),iso()).run();}
 let result:any;
 if(ledger?.status==='done'||ledger?.status==='failed')result=JSON.parse(ledger.result);
 else{
 try{if(call){const wrapper=JSON.parse(call.arguments);const args=JSON.parse(wrapper.arguments_json);result=await performTool(env,s,j.id,actionId,call.name,args);if(JSON.stringify(result).length>100000)result={error:'取得結果が大きいため期間や対象を絞ってください。実行済みの書込があれば履歴で確認してください。'};}
 else result=await modelStep(env,s,d.input,tools);
 await env.DB.prepare("UPDATE autonomy_actions SET status='done',result=?,updated_at=? WHERE id=?").bind(JSON.stringify(result),iso(),actionId).run();
 }catch(e){result={error:e instanceof Error?e.message:'処理できませんでした。'};await env.DB.prepare("UPDATE autonomy_actions SET status='failed',result=?,updated_at=? WHERE id=?").bind(JSON.stringify(result),iso(),actionId).run();}
 }
 d.steps++;
 if(call){d.pending.shift();d.input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});d.summary=result.error?'操作の結果を確認しています。':'必要な調査・施策を進めています。';if(name==='schedule_review'&&result.nextAt)d.nextAt=result.nextAt;if(name==='request_input'&&result.question){d.question=result.question;d.summary=result.question;await finishJob(env,j,d,'needs_input',null);return null;}}
 else{d.calls++;if(result.error){d.summary=result.error;await finishJob(env,j,d,'needs_input',null);return null;}d.tokens+=result.tokens;d.model=result.model;d.input.push(...result.output);d.pending=result.output.filter((o:any)=>o.type==='function_call');const message=result.output.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content??[]).filter((v:any)=>v.type==='output_text').map((v:any)=>v.text).join('\n');if(message)d.summary=message.slice(0,16000);if(!d.pending.length){if(!message){d.summary='モデルから次の行動も結果も返されませんでした。';await finishJob(env,j,d,'needs_input',null);return null;}const next=Math.max(Date.now()+3600000,d.nextAt??Date.now()+p.intervalHours*3600000);await finishJob(env,j,d,'waiting',next);return next;}}
 if(JSON.stringify(d).length>1500000){d.input=[];d.pending=[];d.summary='保存できる入力の上限に達したため停止しました。';await finishJob(env,j,d,'needs_input',null);return null;}
 await env.DB.prepare('UPDATE autonomy_jobs SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(d),iso(),j.id).run();return Date.now()+1000;
 }finally{await env.DB.prepare('UPDATE autonomy_settings SET lease=NULL,lease_until=NULL WHERE business_id=? AND lease=?').bind(scope,lease).run();}
}
