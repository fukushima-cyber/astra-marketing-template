import {pageStatements,cachedPages} from './native-pages.ts';
import type {Env} from './types.ts';
import {readDocument,commitDocument,digest,Conflict} from './storage.ts';
import {documentId} from './business-scope.ts';
import {listConnections,pagesFor,type Target} from './native.ts';
import {windowDates,type Links,type Catalog,type SourceGroup,type Account} from '../lib/connected/model.ts';
import {validDate} from '../lib/analytics/model.ts';
const initial:Links={version:0,groups:{}};
async function catalog(env:Env,scope:string,days:number,custom?:{start:string;end:string}):Promise<Catalog>{
 const connections=await listConnections(env,scope),range=custom??windowDates(days);
 const snapshots=(await env.DB.prepare('SELECT connection_id,resource_id,day,data FROM native_snapshots WHERE business_id=? AND day>=? AND day<=? ORDER BY day').bind(scope,range.start,range.end).all<{connection_id:string;resource_id:string;day:string;data:string}>()).results;
 const accounts:Account[]=[],groups:SourceGroup[]=[];
 for(const c of connections){const rows=snapshots.filter(s=>s.connection_id===c.id);
 if(c.provider==='utage'){for(const target of JSON.parse(c.targets) as Target[])groups.push({id:c.id+':'+target.id,displayName:target.name,funnelIds:[target.id],status:c.enabled?'active':'paused',series:rows.filter(s=>s.resource_id===target.id).map(s=>({date:s.day,...JSON.parse(s.data)}))});}
 else accounts.push({id:c.id,platform:c.provider,handle:rows.length?JSON.parse(rows.at(-1)!.data).handle:c.external_id,displayName:c.label,status:c.enabled&&!c.last_error?'active':'paused',series:rows.filter(s=>s.resource_id==='account').map(s=>({date:s.day,...JSON.parse(s.data)}))});
 }
 return{accounts,groups,globalEnabled:connections.some(c=>c.provider==='utage'&&c.enabled===1),fetchedAt:new Date().toISOString(),errors:connections.filter(c=>c.last_error).map(c=>`${c.label}：${c.last_error}`)};
}
export async function connected(r:Request,env:Env,scope='default'){
 const u=new URL(r.url),action=u.searchParams.get('action')??'catalog',json=(b:unknown,status=200)=>Response.json(b,{status}),docId=documentId(scope,'native-links');
 if(r.method==='GET'&&action==='links')return json((await readDocument(env.DB,docId,initial)).data);
 if(r.method==='POST'&&action==='links'){
 const text=await r.text();if(text.length>50000)return json({error:'入力が大きすぎます。'},413);let b;try{b=JSON.parse(text);}catch{return json({error:'入力が不正です。'},400);}
 if(!b||!Number.isSafeInteger(b.version)||b.version<0||typeof b.groupId!=='string'||!Array.isArray(b.accountIds)||b.accountIds.length>100||b.accountIds.some((id:unknown)=>typeof id!=='string')||new Set(b.accountIds).size!==b.accountIds.length||typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100)return json({error:'対応付けを確認してください。'},400);
 const cat=await catalog(env,scope,7);
 if(!cat.groups.some(g=>g.id===b.groupId)||b.accountIds.some((id:string)=>!cat.accounts.some(a=>a.id===id)))return json({error:'この事業にないファネルまたはアカウントです。'},400);
 const current=(await readDocument(env.DB,docId,initial)).data;
 try{return json(await commitDocument(env.DB,docId,b.version,{version:b.version+1,groups:{...current.groups,[b.groupId]:b.accountIds}},b.requestId,await digest(text)));}catch(e){if(e instanceof Conflict)return json({error:e.message},409);throw e;}
 }
 if(r.method!=='GET')return json({error:'操作できません。'},405);
 if(action==='catalog'){if(u.searchParams.has('start')||u.searchParams.has('end')){const start=u.searchParams.get('start')??'',end=u.searchParams.get('end')??'';if(!validDate(start)||!validDate(end)||start>end)return json({error:'期間を確認してください。'},400);return json(await catalog(env,scope,30,{start,end}));}const days=Number(u.searchParams.get('days')??30);if(![7,30,90].includes(days))return json({error:'期間を確認してください。'},400);return json(await catalog(env,scope,days));}
 if(action==='utage'){
 const start=u.searchParams.get('start')??'',end=u.searchParams.get('end')??'',groupId=u.searchParams.get('groupId')??'';
 if(!validDate(start)||!validDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>89)return json({error:'90日以内の期間を選んでください。'},400);
 const c=(await listConnections(env,scope)).find(c=>JSON.parse(c.targets).some((t:Target)=>c.id+':'+t.id===groupId));
 if(!c)return json({error:'この事業にファネルが見つかりません。'},404);
 const id=(JSON.parse(c.targets) as Target[]).find(t=>c.id+':'+t.id===groupId)!.id;
 try{if(!c.enabled)throw new Error('paused');const pages=await pagesFor(env,c,id,start,end),at=new Date().toISOString();await env.DB.batch(pageStatements(env,c,id,start,end,pages,at));return json({pages,failures:[],collectedAt:at,cached:false});}catch{const saved=await cachedPages(env,c,id,start,end);return saved?json(saved):json({error:'UTAGEから取得できず、この期間の保存済み明細もありません。接続と読取権限を確認してください。'},502);}
 }
 return json({error:'操作が見つかりません。'},404);
}
