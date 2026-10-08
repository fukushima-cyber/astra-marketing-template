import type {Env} from './types.ts';
import {readDocument} from './storage.ts';
import {documentId} from './business-scope.ts';
import {emptyState} from '../lib/improvements/model.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {campaignState,type AgentBoard,type BoardAction} from '../lib/autonomy/board.ts';
const object=(raw:string):any=>{try{return JSON.parse(raw)||{};}catch{return {};}};
// Read every linked mutation, including jobs outside the 30-job history window.
// Prepared arguments remain server-side; the browser only receives explicit display fields.
export async function autonomyBoard(env:Env,scope:string,enabled:boolean):Promise<AgentBoard>{
 const [im,business,ledger,changes]=await Promise.all([
  readDocument(env.DB,documentId(scope,'improvements'),emptyState),
  readDocument(env.DB,documentId(scope,'business'),emptyBusiness),
  env.DB.prepare("SELECT a.*,j.status AS job_status,json_extract(j.data,'$.question') AS question,json_extract(j.data,'$.nextAt') AS next_at FROM autonomy_actions a JOIN autonomy_jobs j ON j.id=a.job_id WHERE j.business_id=? AND a.name IN ('record_skill_usage','create_improvement','prepare_improvement','save_experiment','evaluate_experiment','observe_ad_change','close_improvement','propose_ad_change','execute_ad_change','check_ad_change') ORDER BY a.updated_at DESC,a.created_at DESC,a.id DESC").bind(scope).all<{id:string;job_id:string;name:string;status:string;prepared:string;result:string;updated_at:string;job_status:string;question:string|null;next_at:number|null}>(),
  env.DB.prepare("SELECT id,json_extract(data,'$.caseId') AS case_id FROM ad_changes WHERE business_id=?").bind(scope).all<{id:string;case_id:string|null}>(),
 ]);
 const adCases=new Map(changes.results.map(c=>[c.id,c.case_id]));
 const experiments=new Map(im.data.experiments.map(e=>[e.id,e.caseId]));
 const linked=new Map<string,BoardAction[]>();
 for(const a of ledger.results){
  const body=object(a.prepared).body??{},result=object(a.result);
  const caseId=body.case?.id||body.caseId||body.experiment?.caseId||experiments.get(body.experimentId)||result.caseId||adCases.get(body.changeId)||adCases.get(a.id);
  if(typeof caseId!=='string'||!im.data.cases.some(c=>c.id===caseId))continue;
  const issue=typeof result.error==='string'?result.error: ['failed','blocked'].includes(result.lastOperation?.status)?result.lastOperation.output: (['failed','uncertain','sending'].includes(result.status)||result.needsAcknowledgement===true)?result.message||'反映結果を確認してください。':'';
  const message=typeof result.lastOperation?.output==='string'?result.lastOperation.output:typeof result.message==='string'?result.message:'';
  const item:BoardAction={id:a.id,jobId:a.job_id,name:a.name,status:a.status,at:a.updated_at,issue:String(issue||'').slice(0,2000),message:message.slice(0,2000),jobStatus:a.job_status,question:a.question??'',nextAt:a.next_at,...(a.name==='record_skill_usage'&&result.reported===true?{skill:{name:String(result.skillName),revision:String(result.revision),application:String(result.application),resourcesRead:Array.isArray(result.resourcesRead)?result.resourcesRead.filter((p:unknown)=>typeof p==='string'):[]}}:{})};
  linked.set(caseId,[...(linked.get(caseId)??[]),item]);
 }
 return {executor:'astra',dotConnected:false,generatedAt:new Date().toISOString(),knowledge:im.data.knowledge,campaigns:im.data.cases.filter(c=>linked.has(c.id)).map(c=>{
  const actions=linked.get(c.id)!;
  return {id:c.id,title:c.title,goal:business.data.goals.find(g=>g.id===c.goalId)?.title??'目標未設定・削除済み',funnel:business.data.funnels?.find(f=>f.id===c.funnelId)?.name??(c.funnelId?'ファネル削除済み':'事業全体'),state:campaignState(c.phase,actions[0],enabled),phase:c.phase,operation:c.operation,owner:c.owner,due:c.due,updatedAt:c.updatedAt,hypothesis:c.hypothesis,change:c.after,stopRule:c.stopRule,result:c.result,resultNote:c.resultNote,resultSource:c.resultSource,evidence:c.evidence,preparedRef:c.preparedRef,actions:actions.slice(0,10),actionCount:actions.length};
 }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
}
