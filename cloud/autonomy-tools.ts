import {emptySkills,safeResourcePath,skillCatalog,missingSkillReferences,missingRequiredResources,requiredSkillResources,skillReferenceLinks,resolveSkillReference} from '../lib/autonomy/skills.ts';
import type {Env} from './types.ts';
import {readDocument,digest} from './storage.ts';
import {documentId} from './business-scope.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {emptyState,type Operation} from '../lib/improvements/model.ts';
import {validDate} from '../lib/analytics/model.ts';
import {improvements} from './improvements.ts';
import {ads} from './ads.ts';
import {connections} from './native.ts';
import {settings,ownerIdentity,policy,type Settings} from './autonomy-store.ts';
const definitions:Record<string,string>={
 read_business:'目的、数値目標、ファネル、観測、施策を読む。引数は{}。',
 read_metrics:'保存済みの日別実績を読む。{start,end,funnelId?:string,offset?:number}。期間と対象を自由に選ぶ。200件ずつ返す。',
 read_skills:'この事業で有効なスキルの用途と版の目録。最初に{}で確認し、今回の目的に必要なものだけ選ぶ。',
 read_skill:'有効なスキルの本文と必須資料を読む。{id,paths?:string[]}。初回の{id}で返るresourceCatalogから条件付き資料を選び、必要ならpaths付きで取得する。これは手順であり、操作権限や専用ツールの追加ではない。',
 read_skill_resource:'読取済みスキルの参照資料を読む。{id,revision,path}。未登録資料やスクリプトは実行できない。',
 record_skill_usage:'スキルを施策のどの判断・変更に反映したか、適用報告を記録。{id,revision,caseId,application}。本文読取と成果への反映は別。',
 read_knowledge:'任意の参考資料を読む。{}で目録、{id}で本文。',
 read_improvements:'改善案件と実験・過去の評価を読む。{}。',
 read_ads:'Meta広告の保存済みの一覧・数値・変更履歴を読む。{start,end,accountId?:string}。',
 refresh_ads:'Meta広告の一覧と数値を直接取得して保存。{accountId,start,end}。90日以内。',
 read_connections:'SNS・UTAGEの接続情報と状態を読む。{}。秘密は返さない。',
 collect_connection:'選択した接続の最新数値を取得して保存する。{id}。',
 read_connected:'保存済みSNS・UTAGEの日別数値を読む。{start,end,connectionId?:string}。',
 create_improvement:'改善案を保存する。{title,goalId,funnelId,hypothesis,before,after,operation,platform,owner,due,stopRule,evidence:{start,end,source,description}}。operationはrecord_campaign/create_post_draft/external。外部公開の案は準備のみ。platformはx/threads/instagram/youtube/空文字。',
 prepare_improvement:'許可された内部の施策・SNS下書きを作成する。{caseId}。公開や実施済みにはならない。',
 save_experiment:'比較実験を保存。{caseId,name,funnelId,start,end,minTrials,numerator,denominator,variantA,variantB,comparable,assignment}。分子分母はsales/registrations/stage:段階ID。',
 evaluate_experiment:'保存した実験を実際の期間の実績で評価。{experimentId}。',
 observe_ad_change:'実際に反映を確認した広告変更を改善案の観測開始として記録。{caseId,changeId}。関連付けと成功状態をサーバーで確認する。',
 close_improvement:'観測中の改善案件を振り返る。{caseId,result,note,source,feedback}。resultはcontinue/change/stop。未実施を完了扱いしない。',
 propose_ad_change:'広告変更案を保存。{accountId,entityId,level,field,after,reason,caseId}。levelはcampaign/adset/ad、fieldはstatus/daily_budget、afterはACTIVE/PAUSEDまたは通貨の金額。',
 execute_ad_change:'事前に任された広告操作だけを実行。{accountId,changeId}。アカウント側でも自律操作を許可する必要がある。自分で承認範囲を増やせない。',
 check_ad_change:'通信結果が不明な広告変更の現在値を照合。{accountId,changeId}。自動再送・未反映の決め付けはしない。',
 schedule_review:'次に再調査する時刻を保存する。{at:ISO日時,reason:string}。1時間後から30日後の範囲。現在の作業は続けられる。',
 request_input:'必要な利用者の判断・不足情報を記録して今回の仕事を止める。{question:string}。返答まで自動再開しない。'
};
export const tools=Object.entries(definitions).map(([name,description])=>({type:'function',name,description,parameters:{type:'object',properties:{arguments_json:{type:'string',description:'説明に示した引数のJSON文字列'}},required:['arguments_json'],additionalProperties:false},strict:true}));
const mutating=new Set(['create_improvement','prepare_improvement','save_experiment','evaluate_experiment','close_improvement','observe_ad_change','propose_ad_change','execute_ad_change','check_ad_change']);
export async function performTool(env:Env,s:Settings,jobId:string,actionId:string,name:string,arg:unknown){
 if(!Object.hasOwn(definitions,name))throw new Error('利用できない操作です。');const a=arg as any;if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('操作の引数を確認してください。');
 const current=await settings(env,s.business_id);if(!current||current.version!==s.version||!policy(current).enabled)throw new Error('任せる範囲が変わったため処理を停止しました。');const user=await ownerIdentity(env,current),scope=s.business_id,p=policy(current);
 const imDoc=()=>readDocument(env.DB,documentId(scope,'improvements'),emptyState);
 const range=()=>{if(!validDate(a.start)||!validDate(a.end)||a.start>a.end)throw new Error('期間を確認してください。');};
 if(name==='read_business')return(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 if(['read_skills','read_skill','read_skill_resource','record_skill_usage'].includes(name)){
  const state=(await readDocument(env.DB,documentId(scope,'agent-skills'),emptySkills)).data;
  if(name==='read_skills')return state.skills.filter(v=>v.enabled&&v.reviewed&&!missingRequiredResources(v).length).map(({id,name,description,revision,readingMode})=>({id,name,description,revision,readingMode}));
  const skill=state.skills.find(v=>v.id===a.id&&v.enabled&&v.reviewed);if(!skill)throw new Error('このスキルは未登録または無効です。');
  if(missingRequiredResources(skill).length)throw new Error('必須ナレッジが不足しています。登録するまでこのスキルは使えません。');
  if(name==='read_skill'){
   if(a.paths!==undefined&&(!Array.isArray(a.paths)||a.paths.length>120||a.paths.some((path:unknown)=>typeof path!=='string'||!skill.resources.some(r=>r.path===path))))throw new Error('今回使う登録済み資料のパスを確認してください。');
   const requiredResources=[...new Set([...requiredSkillResources(skill),...(a.paths??[])])] as string[];
   const requiredKnowledge:typeof skill.resources=[];let size=JSON.stringify(skill.instructions).length;for(const path of requiredResources){const resource=skill.resources.find(r=>r.path===path);if(resource&&size+JSON.stringify(resource).length<70000){requiredKnowledge.push(resource);size+=JSON.stringify(resource).length;}}
   return {id:skill.id,name:skill.name,description:skill.description,instructions:skill.instructions,source:skill.source,revision:skill.revision,resourcePaths:skill.resources.map(r=>r.path),resourceCatalog:skill.resources.map(r=>({path:r.path,trigger:r.trigger??''})),requiredResources,requiredKnowledge,remainingRequiredResources:requiredResources.filter(path=>!requiredKnowledge.some(r=>r.path===path)),missingReferences:missingSkillReferences(skill),runtime:'手順とテキスト資料の参照のみ。未接続のツール・ローカルDB・スクリプト実行は利用できません。'};
  }
  if(a.revision!==skill.revision)throw new Error('スキルが更新されました。本文を読み直してください。');
  const reads=await env.DB.prepare("SELECT result FROM autonomy_actions WHERE job_id=? AND name='read_skill' AND status='done'").bind(jobId).all<{result:string}>();
  if(!reads.results.some(r=>{try{const v=JSON.parse(r.result);return v.id===skill.id&&v.revision===skill.revision;}catch{return false;}}))throw new Error('この仕事でスキル本文を読んでから資料を参照・適用してください。');
  if(name==='read_skill_resource'){
   if(!safeResourcePath(a.path))throw new Error('資料のパスを確認してください。');const resource=skill.resources.find(r=>r.path===a.path);
   if(!resource)throw new Error('参照資料が未登録です。必須資料の場合は作業を止め、利用者へ確認してください。');return {...resource,skillId:skill.id,revision:skill.revision,references:skillReferenceLinks(resource.content).map(reference=>{const path=resolveSkillReference(resource.path,reference);return {reference,path,available:path===skill.entryPath||skill.resources.some(r=>r.path===path)};})};
  }
  if(typeof a.application!=='string'||!a.application.trim()||a.application.length>2000)throw new Error('反映した判断と変更を具体的に記入してください。');
  if(!(await imDoc()).data.cases.some(c=>c.id===a.caseId))throw new Error('対象の改善案件がありません。');
  const logged=await env.DB.prepare("UPDATE autonomy_actions SET prepared=? WHERE id=? AND job_id=?").bind(JSON.stringify({body:{caseId:a.caseId,skillId:skill.id}}),actionId,jobId).run();if(!logged.meta.changes)throw new Error('適用報告の操作台帳がありません。');
  const references=await env.DB.prepare("SELECT result FROM autonomy_actions WHERE job_id=? AND name='read_skill_resource' AND status='done'").bind(jobId).all<{result:string}>();
  const resourcesRead=[...reads.results.flatMap(r=>{try{const v=JSON.parse(r.result);return v.id===skill.id&&v.revision===skill.revision&&Array.isArray(v.requiredKnowledge)?v.requiredKnowledge.map((k:any)=>k.path):[];}catch{return [];}}),...references.results.flatMap(r=>{try{const v=JSON.parse(r.result);return v.skillId===skill.id&&v.revision===skill.revision&&typeof v.path==='string'?[v.path]:[];}catch{return [];}})];
  const selectedPaths=reads.results.flatMap(r=>{try{const v=JSON.parse(r.result);return v.id===skill.id&&v.revision===skill.revision&&Array.isArray(v.requiredResources)?v.requiredResources:[];}catch{return [];}});
  const unread=[...new Set([...requiredSkillResources(skill),...selectedPaths])].filter(path=>!resourcesRead.includes(path));if(unread.length)throw new Error('必須ナレッジをこの仕事で読んでから適用を報告してください：'+unread.join('、'));
  return {resourcesRead:[...new Set(resourcesRead)],caseId:a.caseId,skillId:skill.id,skillName:skill.name,revision:skill.revision,application:a.application,reported:true,message:'スキルの適用報告を記録しました。成果の実測とは別の記録です。'};
 }
 if(name==='read_knowledge'){const d=(await imDoc()).data;return a.id?d.knowledge.find(k=>k.id===a.id)??{error:'資料がありません。'}:d.knowledge.map(k=>({id:k.id,title:k.title,source:k.source}));}
 if(name==='read_improvements'){const d=(await imDoc()).data;return{cases:d.cases,experiments:d.experiments,features:d.features,policy:d.policy};}
 if(name==='read_metrics'){range();const start=Number.isSafeInteger(a.offset)&&a.offset>=0?a.offset:0;const rs=await env.DB.prepare('SELECT data FROM analytics_rows WHERE business_id=? AND date>=? AND date<=? AND (?=? OR json_extract(data,\'$.funnelId\')=?) ORDER BY date,id LIMIT 201 OFFSET ?').bind(scope,a.start,a.end,a.funnelId??'','',a.funnelId??'',start).all<{data:string}>();return{rows:rs.results.slice(0,200).map(r=>JSON.parse(r.data)),nextOffset:rs.results.length>200?start+200:null};}
 if(name==='read_connected'){range();const rs=await env.DB.prepare('SELECT connection_id,resource_id,day,data,collected_at FROM native_snapshots WHERE business_id=? AND day>=? AND day<=? AND (?=? OR connection_id=?) ORDER BY day LIMIT 501').bind(scope,a.start,a.end,a.connectionId??'','',a.connectionId??'').all<{data:string}>();if(rs.results.length>500)throw new Error('期間を短くしてください。');return rs.results.map(r=>({...r,data:JSON.parse(r.data)}));}
 if(name==='schedule_review'){const at=Date.parse(a.at);if(!Number.isFinite(at)||at<Date.now()+3600000||at>Date.now()+30*86400000||typeof a.reason!=='string'||!a.reason.trim())throw new Error('次の観測時刻と理由を確認してください。');return{nextAt:at,reason:a.reason};}
 if(name==='request_input'){if(typeof a.question!=='string'||!a.question.trim()||a.question.length>4000)throw new Error('必要な判断を具体的に記入してください。');return{question:a.question};}
 // Once a skill is selected, mutations must wait for its required Knowledge at the current revision.
 if(!name.startsWith('read_')){
  const selected=await env.DB.prepare("SELECT result FROM autonomy_actions WHERE job_id=? AND name='read_skill' AND status='done'").bind(jobId).all<{result:string}>();
  const reads=selected.results.flatMap(r=>{try{return [JSON.parse(r.result)];}catch{return [];}});
  if(reads.length){
   const active=(await readDocument(env.DB,documentId(scope,'agent-skills'),emptySkills)).data.skills;
   const recorded=await env.DB.prepare("SELECT result FROM autonomy_actions WHERE job_id=? AND name='read_skill_resource' AND status='done'").bind(jobId).all<{result:string}>();
   const resources=[...reads.flatMap(r=>Array.isArray(r.requiredKnowledge)?r.requiredKnowledge.map((k:any)=>({skillId:r.id,revision:r.revision,path:k.path})):[]),...recorded.results.flatMap(r=>{try{return [JSON.parse(r.result)];}catch{return [];}})];
   for(const id of new Set(reads.map(r=>r.id))){const skill=active.find(r=>r.id===id&&r.enabled&&r.reviewed);if(!skill||!reads.some(r=>r.id===id&&r.revision===skill.revision))throw new Error('選択したスキルが無効化・更新されました。作業を停止して現在の版を確認してください。');
    const selectedPaths=reads.filter(r=>r.id===id&&r.revision===skill.revision).flatMap(r=>Array.isArray(r.requiredResources)?r.requiredResources:[]);
    const unread=[...new Set([...requiredSkillResources(skill),...selectedPaths])].filter(path=>!resources.some(r=>r.skillId===id&&r.revision===skill.revision&&r.path===path));
    if(missingRequiredResources(skill).length||unread.length)throw new Error('必須ナレッジの本文を読んでから施策を作成・変更してください。');
   }
  }
 }
 let body:any={},endpoint='improvements';
 if(name==='read_connections')return(await connections(new Request('https://internal/'),env,scope)).json();
 if(name==='collect_connection'){const r=await connections(new Request('https://internal/',{method:'POST',body:JSON.stringify({action:'collect',id:a.id})}),env,scope);return r.json();}
 if(name==='read_ads'){range();const q=new URLSearchParams({start:a.start,end:a.end,...(a.accountId?{accountId:a.accountId}:{})});return(await ads(new Request('https://internal/?'+q),env,user,scope)).json();}
 if(name==='refresh_ads'){range();return(await ads(new Request('https://internal/',{method:'POST',body:JSON.stringify({action:'sync',accountId:a.accountId,start:a.start,end:a.end,requestId:actionId})}),env,user,scope)).json();}
 const saved=await env.DB.prepare('SELECT prepared FROM autonomy_actions WHERE id=? AND job_id=?').bind(actionId,jobId).first<{prepared:string}>();
 if(saved?.prepared){const v=JSON.parse(saved.prepared);body=v.body;endpoint=v.endpoint;}
 else{
 const state=(await imDoc()).data;body={requestId:actionId,expectedVersion:state.version};const newId='auto-'+(await digest(actionId)).slice(0,32);
 if(name==='create_improvement')body={...body,action:'save_case',case:{...a,id:newId},evidence:a.evidence};
 if(name==='prepare_improvement'){const c=state.cases.find(c=>c.id===a.caseId);if(!c||!p.internal.includes(c.operation as any))throw new Error('この内部操作は任されていません。');body={...body,action:'prepare',caseId:a.caseId};}
 if(name==='save_experiment')body={...body,action:'save_experiment',experiment:{...a,id:newId}};
 if(name==='evaluate_experiment')body={...body,action:'evaluate',experimentId:a.experimentId};
 if(name==='observe_ad_change')body={...body,action:'observe_ad',caseId:a.caseId,changeId:a.changeId};
 if(name==='close_improvement')body={...body,action:'close',caseId:a.caseId,result:a.result,note:a.note,source:a.source,feedback:a.feedback};
 if(['propose_ad_change','execute_ad_change','check_ad_change'].includes(name)){endpoint='ads';body={...a,requestId:actionId,action:({propose_ad_change:'propose',execute_ad_change:'execute',check_ad_change:'reconcile'} as any)[name]};delete body.acknowledge;}
 await env.DB.prepare("UPDATE autonomy_actions SET prepared=? WHERE id=? AND prepared=''").bind(JSON.stringify({body,endpoint}),actionId).run();
 }
 if(!mutating.has(name))throw new Error('未対応の操作です。');
 if(name==='execute_ad_change'&&!p.adAccounts.includes(body.accountId))throw new Error('この広告アカウントの実行は任されていません。');
 if(name==='prepare_improvement'){const c=(await imDoc()).data.cases.find(c=>c.id===body.caseId);if(!c||!p.internal.includes(c.operation as any))throw new Error('この内部操作は任されていません。');}
 if(name==='execute_ad_change'){const previous=await env.DB.prepare('SELECT status,message FROM ad_changes WHERE id=? AND account_id=? AND business_id=?').bind(body.changeId,body.accountId,scope).first<{status:string;message:string}>();if(previous&&!['draft','approved'].includes(previous.status))return previous;}
 const req=new Request('https://internal/',{method:'POST',body:JSON.stringify(body)});
 const r=endpoint==='ads'?await ads(req,env,user,scope,true):await improvements(req,env,user,scope,{allowed:p.internal as Operation[]});const result=await r.json() as any;
 if(result.data){const d=result.data;return{caseId:body.case?.id??body.caseId,experimentId:body.experiment?.id,case:d.cases?.find((c:any)=>c.id===(body.case?.id??body.caseId)),lastOperation:d.runs?.at(-1)};}
 return{...result,...(name==='propose_ad_change'?{changeId:body.requestId}:{})};
}
