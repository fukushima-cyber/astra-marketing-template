import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,digest,Conflict} from './storage.ts';
import {emptySkills,validateSkill,skillCatalog,type AgentSkill} from '../lib/autonomy/skills.ts';
const json=(v:unknown,status=200)=>Response.json(v,{status});
export async function agentSkills(r:Request,env:Env,user:Identity,scope:string){
 if(!can(user,scope,'autonomy'))return json({error:'この事業のエージェントを閲覧する権限がありません。'},403);
 try{
  const id=documentId(scope,'agent-skills'),doc=await readDocument(env.DB,id,emptySkills);
  if(r.method==='GET'){
   const selected=new URL(r.url).searchParams.get('id');
   if(selected){const skill=doc.data.skills.find(s=>s.id===selected);return skill?json({skill,version:doc.version}):json({error:'スキルがありません。'},404);}
   return json({...skillCatalog(doc.data),version:doc.version});
  }
  if(r.method!=='POST')return json({error:'操作できません。'},405);
  if(user.role!=='owner')return json({error:'スキルの登録と有効化は全体管理者が行います。'},403);
  const raw=await r.text();if(raw.length>1000000)throw new Error('登録内容が大きすぎます。');const b=JSON.parse(raw);
  if(!Number.isSafeInteger(b.expectedVersion)||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId))throw new Error('保存する版と操作番号を確認してください。');
  let skills=doc.data.skills;
  if(b.action==='save'){
   validateSkill(b.skill);
   const {id,name,description,instructions,resources,readingMode,entryPath,requiredResources,source,enabled,reviewed}=b.skill;
   const content={id,name,description,instructions,resources,readingMode,entryPath,requiredResources,source,enabled,reviewed};
   const skill:AgentSkill={...content,revision:await digest(JSON.stringify(content)),updatedAt:new Date().toISOString()};
   skills=[...skills.filter(s=>s.id!==id),skill];
  }else if(b.action==='delete'){
   if(typeof b.id!=='string'||!skills.some(s=>s.id===b.id))throw new Error('削除するスキルを確認してください。');skills=skills.filter(s=>s.id!==b.id);
  }else throw new Error('操作を確認してください。');
  if(skills.length>20||new TextEncoder().encode(JSON.stringify(skills)).byteLength>1000000)throw new Error('事業あたり20件、合計1MBまでです。');
  const state=await commitDocument(env.DB,id,b.expectedVersion,{version:b.expectedVersion+1,skills},b.requestId,await digest(raw));
  return json(skillCatalog(state));
 }catch(e){return json({error:e instanceof SyntaxError?'入力形式を確認してください。':e instanceof Error?e.message:'保存できませんでした。'},e instanceof Conflict?409:400);}
}
