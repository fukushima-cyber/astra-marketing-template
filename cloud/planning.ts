import {safeAnalysisPath} from '../lib/analysis-handoff.ts';
import type {Fact} from '../lib/analytics/model.ts';
import type {Env} from './types.ts';
import {can,permission,type Identity} from '../lib/access.ts';
import {emptyBusiness,type Campaign,type WorkTask} from '../lib/marketing-business/types.ts';
import {validateBusiness} from '../lib/marketing-business/validate.ts';
import {documentId} from './business-scope.ts';
import {commitDocument,readDocument,digest,Conflict} from './storage.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status});
export async function planning(r:Request,env:Env,user:Identity,scope:string){
 const view=new URL(r.url).searchParams.get('view')??'work';
 if(!['okr','work','tasks'].includes(view))return json({error:'画面を確認してください。'},400);
 const edit=r.method!=='GET';
 const access=view==='tasks'?'work':view as 'okr'|'work';
 if(!can(user,scope,access,edit)&&!can(user,scope,'business',edit))return json({error:'この画面の操作は許可されていません。'},403);
 const id=documentId(scope,'business'),doc=await readDocument(env.DB,id,emptyBusiness);
 const assignees=['tasks','work'].includes(view)?(await env.DB.prepare("SELECT DISTINCT u.id,u.name FROM users u LEFT JOIN access_grants g ON g.user_id=u.id AND g.business_id=? AND g.page IN ('work','business') AND g.edit=1 WHERE u.company_id=? AND u.active=1 AND (u.role='owner' OR g.user_id IS NOT NULL) ORDER BY u.name,u.id").bind(scope,user.companyId).all<{id:string;name:string}>()).results:[];
 const taskRows=()=> (doc.data.tasks??[]).map(task=>task.assigneeId?{...task,assignee:assignees.find(member=>member.id===task.assigneeId)?.name??task.assignee}:task);
 const campaignRows=()=>doc.data.campaigns.map(c=>c.assigneeId?{...c,assignee:assignees.find(member=>member.id===c.assigneeId)?.name??c.assignee}:c);
 const output=()=>view==='okr'?{data:{version:doc.data.version,objective:doc.data.objective,projects:doc.data.projects??[],funnels:doc.data.funnels??[],goals:doc.data.goals,observations:doc.data.observations,campaigns:doc.data.campaigns}}:view==='tasks'?{data:{version:doc.data.version,assignees,campaigns:doc.data.campaigns.map(c=>({id:c.id,title:c.title})),tasks:taskRows()}}:{data:{version:doc.data.version,assignees,goals:doc.data.goals.map(g=>({id:g.id,title:g.title})),campaigns:campaignRows()}};
 if(r.method==='GET')return json(output());
 if(r.method!=='POST'||view==='okr')return json({error:'目標の編集は目標設定で行ってください。'},405);
 let b;try{const raw=await r.text();if(raw.length>30000)throw new Error();b=JSON.parse(raw);}catch{return json({error:'入力を確認してください。'},400);}
 if(!b||!Number.isSafeInteger(b.expectedVersion)||typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100||(view==='work'?(!b.campaign||typeof b.campaign.id!=='string'):(!b.task||typeof b.task.id!=='string')))return json({error:'操作情報を確認してください。'},400);
 const signature=await digest(JSON.stringify(b)),receipt=await env.DB.prepare('SELECT signature FROM receipts WHERE id=?').bind(id+':'+b.requestId).first<{signature:string}>();
 if(receipt){if(receipt.signature!==signature)throw new Conflict('操作識別子が競合しています。');return json(output());}
 if(doc.data.version!==b.expectedVersion)throw new Conflict('別の画面で更新されています。再取得して確認してください。');
 if(view==='tasks'){
  const task=b.task,old=(doc.data.tasks??[]).find(v=>v.id===task.id),done=task.status==='done',requestedAssigneeId=typeof task.assigneeId==='string'?task.assigneeId:(old?.assigneeId??''),member=assignees.find(value=>value.id===requestedAssigneeId);
  if(requestedAssigneeId&&!member)return json({error:'担当者を選び直してください。'},400);
  const legacyAssignee=old&&!old.assigneeId&&task.assigneeId===undefined?old.assignee:'';
  const next:WorkTask={id:task.id,title:task.title,status:task.status,priority:task.priority,assignee:member?.name??legacyAssignee,assigneeId:member?.id,due:task.due,notes:task.notes,campaignId:task.campaignId||undefined,completedAt:done?(old?.status==='done'&&old.completedAt?old.completedAt:new Date().toISOString()):undefined};
  if(!old&&b.create!==true)return json({error:'タスクが見つかりません。'},404);
  const tasks=old?(doc.data.tasks??[]).map(v=>v.id===next.id?next:v):[...(doc.data.tasks??[]),next];
  const data=validateBusiness({...doc.data,tasks});data.version++;data.updatedAt=new Date().toISOString();await commitDocument(env.DB,id,doc.version,data,b.requestId,signature);
  return json({data:{version:data.version,assignees,campaigns:data.campaigns.map(c=>({id:c.id,title:c.title})),tasks:data.tasks??[]}});
 }
 const c=b.campaign,old=doc.data.campaigns.find(v=>v.id===c.id),requestedAssigneeId=typeof c.assigneeId==='string'?c.assigneeId:(old?.assigneeId??''),member=assignees.find(value=>value.id===requestedAssigneeId);
 if(requestedAssigneeId&&!member)return json({error:'担当者を選び直してください。'},400);
 const legacyAssignee=old&&!old.assigneeId&&c.assigneeId===undefined?old.assignee:'';
 let evidence=old?.evidence;
 if(!old&&c.evidence){const e=c.evidence;if(!can(user,scope,'analytics'))return json({error:'分析の根拠を参照する権限がありません。'},403);if(!Array.isArray(e.factIds)||e.factIds.length>500||!e.factIds.length||new Set(e.factIds).size!==e.factIds.length||e.factIds.some((v:unknown)=>typeof v!=='string'||v.length>100)||typeof e.digest!=='string'||!e.filter||!safeAnalysisPath(e.returnPath,scope))return json({error:'分析の根拠を確認してください。'},400);const projects=permission(user,scope,'analytics')?.projects??null;const rows=(await env.DB.prepare('SELECT data FROM analytics_rows WHERE business_id=? AND id IN (SELECT value FROM json_each(?)) AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?))) ORDER BY id').bind(scope,JSON.stringify(e.factIds),projects===null?null:JSON.stringify(projects),JSON.stringify(projects)).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Fact);if(rows.length!==e.factIds.length||await digest(JSON.stringify(rows.sort((a,b)=>a.id.localeCompare(b.id))))!==e.digest)return json({error:'根拠の版が一致しません。分析画面から再度作成してください。'},409);evidence={factIds:rows.map(r=>r.id),digest:e.digest,capturedAt:new Date().toISOString(),returnPath:e.returnPath,filter:e.filter};}
 // Only these fields can be changed from the work page; hidden business fields never come from the request.
 const next:Campaign={evidence,id:c.id,title:c.title,goalId:c.goalId,hypothesis:c.hypothesis,change:c.change,comparison:c.comparison,stopRule:c.stopRule,reason:c.reason,source:c.source,start:c.start,end:c.end,result:c.result,phase:c.phase,assignee:member?.name??legacyAssignee,assigneeId:member?.id,postIds:old?.postIds??[],funnelId:old?.goalId===c.goalId?old?.funnelId:undefined};
 if(!old&&b.create!==true)return json({error:'施策が見つかりません。'},404);
 const data=validateBusiness({...doc.data,campaigns:old?doc.data.campaigns.map(v=>v.id===next.id?next:v):[...doc.data.campaigns,next]});
 data.version++;data.updatedAt=new Date().toISOString();await commitDocument(env.DB,id,doc.version,data,b.requestId,signature);
 return json({data:{version:data.version,assignees,goals:data.goals.map(g=>({id:g.id,title:g.title})),campaigns:data.campaigns}});
}
