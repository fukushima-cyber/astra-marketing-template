import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {emptyBusiness,type Campaign} from '../lib/marketing-business/types.ts';
import {validateBusiness} from '../lib/marketing-business/validate.ts';
import {documentId} from './business-scope.ts';
import {commitDocument,readDocument,digest,Conflict} from './storage.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status});
export async function planning(r:Request,env:Env,user:Identity,scope:string){
 const view=new URL(r.url).searchParams.get('view')??'work';
 if(!['okr','work'].includes(view))return json({error:'画面を確認してください。'},400);
 const edit=r.method!=='GET';
 if(!can(user,scope,view as 'okr'|'work',edit)&&!can(user,scope,'business',edit))return json({error:'この画面の操作は許可されていません。'},403);
 const id=documentId(scope,'business'),doc=await readDocument(env.DB,id,emptyBusiness);
 const output=()=>view==='okr'?{data:{version:doc.data.version,objective:doc.data.objective,projects:doc.data.projects??[],funnels:doc.data.funnels??[],goals:doc.data.goals,observations:doc.data.observations,campaigns:doc.data.campaigns}}:{data:{version:doc.data.version,goals:doc.data.goals.map(g=>({id:g.id,title:g.title})),campaigns:doc.data.campaigns}};
 if(r.method==='GET')return json(output());
 if(r.method!=='POST'||view!=='work')return json({error:'目標の編集は目標設定で行ってください。'},405);
 let b;try{const raw=await r.text();if(raw.length>30000)throw new Error();b=JSON.parse(raw);}catch{return json({error:'入力を確認してください。'},400);}
 if(!b||!Number.isSafeInteger(b.expectedVersion)||typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100||!b.campaign||typeof b.campaign.id!=='string')return json({error:'操作情報を確認してください。'},400);
 const signature=await digest(JSON.stringify(b)),receipt=await env.DB.prepare('SELECT signature FROM receipts WHERE id=?').bind(id+':'+b.requestId).first<{signature:string}>();
 if(receipt){if(receipt.signature!==signature)throw new Conflict('操作識別子が競合しています。');return json(output());}
 if(doc.data.version!==b.expectedVersion)throw new Conflict('別の画面で更新されています。再取得して確認してください。');
 const c=b.campaign,old=doc.data.campaigns.find(v=>v.id===c.id);
 // Only these fields can be changed from the work page; hidden business fields never come from the request.
 const next:Campaign={id:c.id,title:c.title,goalId:c.goalId,hypothesis:c.hypothesis,change:c.change,comparison:c.comparison,stopRule:c.stopRule,reason:c.reason,source:c.source,start:c.start,end:c.end,result:c.result,phase:c.phase,assignee:c.assignee,postIds:old?.postIds??[],funnelId:old?.goalId===c.goalId?old?.funnelId:undefined};
 if(!old&&b.create!==true)return json({error:'施策が見つかりません。'},404);
 const data=validateBusiness({...doc.data,campaigns:old?doc.data.campaigns.map(v=>v.id===next.id?next:v):[...doc.data.campaigns,next]});
 data.version++;data.updatedAt=new Date().toISOString();await commitDocument(env.DB,id,doc.version,data,b.requestId,signature);
 return json({data:{version:data.version,goals:data.goals.map(g=>({id:g.id,title:g.title})),campaigns:data.campaigns}});
}
