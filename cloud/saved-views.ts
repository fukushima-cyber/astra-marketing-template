import {can,type Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,Conflict,digest} from './storage.ts';
import type {Env} from './types.ts';
export const viewKeys=['start','end','projectId','funnelId','sourceType','platform','q','analysisView','axis','column','metric','density','columns'];
export type SavedView={id:string;name:string;params:Record<string,string>};
export async function savedViews(r:Request,env:Env,user:Identity,scope:string){
 const json=(v:unknown,status=200)=>Response.json(v,{status});if(!can(user,scope,'analytics'))return json({error:'実績の閲覧権限が必要です。'},403);
 try{const id=documentId(scope,'views-'+user.id),doc=await readDocument(env.DB,id,{version:0,views:[] as SavedView[]});if(r.method==='GET')return json(doc.data);if(r.method!=='POST')return json({error:'操作できません。'},405);
 const raw=await r.text();if(raw.length>20000)throw new Error('保存内容が大きすぎます。');const b=JSON.parse(raw);if(!Number.isSafeInteger(b.expectedVersion)||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId)||!Array.isArray(b.views)||b.views.length>30)throw new Error('保存する表示を確認してください。');
 const ids=new Set<string>();const views:SavedView[]=b.views.map((v:SavedView)=>{if(!v||typeof v.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(v.id)||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>100||!v.params||typeof v.params!=='object'||Array.isArray(v.params))throw new Error('表示名を確認してください。');ids.add(v.id);const params:Record<string,string>={};for(const [k,value] of Object.entries(v.params)){if(!viewKeys.includes(k)||typeof value!=='string'||value.length>1000)throw new Error('フィルターを確認してください。');params[k]=value;}return{id:v.id,name:v.name.trim(),params};});const state={version:b.expectedVersion+1,views};await commitDocument(env.DB,id,b.expectedVersion,state,b.requestId,await digest(raw));return json(state);
 }catch(e){return json({error:e instanceof Error?e.message:'保存できませんでした。'},e instanceof Conflict?409:400);}
}
