import {autonomy} from './autonomy.ts';
import {ads} from './ads.ts';
import {improvements} from './improvements.ts';
import {scheduledImprovements} from './improvement-schedule.ts';
import {planning} from './planning.ts';
import {connections,scheduled} from './native.ts';
import {documentId,resolveBusiness,businesses} from './business-scope.ts';
import { connected } from './connected.ts';
import { analytics } from './analytics.ts';
import type { Env } from './types.ts';
import {login,loginPage,authPage,authScript,logout,sameOrigin} from './auth.ts';
import {currentUser,audit} from './identity.ts';
import {company,owner,visibleBusinesses} from './company.ts';
import {can,permission,type AccessPage} from '../lib/access.ts';
import { commitDocument,Conflict,digest,readDocument } from './storage.ts';
import { validateBusiness } from '../lib/marketing-business/validate.ts';
import { emptyBusiness } from '../lib/marketing-business/types.ts';
import { PostizError,type PostizDraft } from '../lib/postiz/types.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function body(r:Request){const text=await r.text();if(new TextEncoder().encode(text).length>900000)throw new PostizError('入力が大きすぎます。','validation');const b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.requestId!=='string'||!b.requestId.trim()||b.requestId.length>200||'companyId'in b)throw new PostizError('操作情報が不正です。','validation');return b;}
async function postiz(r:Request,env:Env,scope='default'){const u=new URL(r.url),docId=documentId(scope,'drafts'),doc=await readDocument<PostizDraft[]>(env.DB,docId,[]);if(r.method==='GET'){const action=u.searchParams.get('action');if(action==='drafts')return json({drafts:doc.data});if(action==='status')return json({configured:false,reason:'クラウド版のPostiz実接続は未設定です。'});return json({error:'Postiz実接続は未設定です。'},503);}const b=await body(r),signature=await digest(JSON.stringify(b));const newId='draft-'+(await digest(b.requestId)).slice(0,32);const replay=await env.DB.prepare('SELECT signature FROM receipts WHERE id = ?').bind(docId+':'+b.requestId).first<{signature:string}>();if(replay){if(replay.signature!==signature)throw new Conflict('操作識別子が競合しています。');return json({draft:doc.data.find(d=>d.id===(b.draft?.id??b.draftId??newId))});}let draft:PostizDraft;
 if(b.action==='save'){
 const d=b.draft;if(!d||typeof d.title!=='string'||!d.title.trim()||d.title.length>100||typeof d.content!=='string'||!d.content.trim()||d.content.length>4000||typeof d.goalId!=='string'||!d.goalId||!['x','threads','instagram','youtube'].includes(d.platform)||d.assetIds?.length||d.options?.thumbnailId)throw new PostizError('題名・本文・目標・SNSを確認してください。素材はクラウド版に未接続です。','validation');
 const old=d.id?doc.data.find(x=>x.id===d.id):undefined;if(d.id&&(!old||old.version!==b.expectedVersion))throw new Conflict('下書きが更新されています。再取得してください。');
 if(d.scheduleAt!==undefined&&(typeof d.scheduleAt!=='string'||!Number.isFinite(Date.parse(d.scheduleAt))))throw new PostizError('日時が不正です。','validation');
 const now=new Date().toISOString();draft={id:old?.id??newId,version:(old?.version??0)+1,title:d.title,content:d.content,goalId:d.goalId,platform:d.platform,assetIds:[],options:d.options??{},scheduleAt:d.scheduleAt,createdAt:old?.createdAt??now,updatedAt:now,remotePostIds:[],syncStatus:'local',reviewState:'editing'};
 }else if(b.action==='review'){
 const old=doc.data.find(x=>x.id===b.draftId);if(!old||old.version!==b.expectedVersion)throw new Conflict('下書きが更新されています。');if(!['pending','changes','rejected'].includes(b.state)||typeof b.note!=='string'||b.note.length>2000)throw new PostizError('確認内容が不正です。','validation');draft={...old,version:old.version+1,reviewState:b.state,reviewNote:b.note,updatedAt:new Date().toISOString()};
 }else return json({error:'クラウド版のSNS実投稿は未接続です。'},503);
 const next=[...doc.data.filter(d=>d.id!==draft.id),draft];await commitDocument(env.DB,docId,doc.version,next,b.requestId,signature);return json({draft});
}
async function route(r:Request,env:Env){const u=new URL(r.url);
 if(u.pathname==='/login'){if(r.method==='GET')return loginPage();if(r.method==='POST')return login(r,env);return json({error:'操作できません。'},405);}
 if(u.pathname==='/join'){if(r.method==='GET')return authPage('join');if(r.method==='POST')return login(r,env,true);return json({error:'操作できません。'},405);}
 if(u.pathname==='/auth-form.js'&&r.method==='GET')return authScript();
 const user=await currentUser(r,env);
 if(!user){if(u.pathname.startsWith('/api/'))return json({error:'ログインしてください。'},401);return new Response(null,{status:303,headers:{Location:'/login','Cache-Control':'no-store'}});}
 if(!['GET','HEAD'].includes(r.method)&&!sameOrigin(r))return json({error:'接続元が一致しません。'},403);
 if(u.pathname==='/logout'&&r.method==='POST')return logout(r,env);
 if(u.pathname==='/api/me'&&r.method==='GET')return json({user});
 if(u.pathname==='/api/company')return company(r,env,user);
 if(u.pathname==='/api/owner')return owner(r,env,user);
 if(/^\/owner(?:\/|\.|$)/.test(u.pathname)&&user.role!=='owner')return new Response('この画面は全体管理者専用です。',{status:403});
 if(u.pathname==='/api/marketing/businesses'){
 if(r.method==='GET')return json({businesses:await visibleBusinesses(env,user)});
 if(user.role!=='owner')return json({error:'事業の追加・変更は全体管理者が行います。'},403);
 const result=await businesses(r,env);if(result.ok)await audit(env,user.id,'business.updated','businesses');return result;
 }
 const businessScope=u.pathname.startsWith('/api/marketing')?await resolveBusiness(r,env):null;
 if(u.pathname.startsWith('/api/marketing')&&(!businessScope||!((await visibleBusinesses(env,user)).some(b=>b.id===businessScope.id))))return json({error:'事業が見つかりません。事業を選び直してください。'},404);
 const scope=businessScope?.id??'default';
 if(u.pathname==='/api/marketing/autonomy')return autonomy(r,env,user,scope);
 if(u.pathname==='/api/marketing/ads')return ads(r,env,user,scope);
 if(u.pathname==='/api/marketing/improvements')return improvements(r,env,user,scope);
 if(u.pathname==='/api/marketing/plan')return planning(r,env,user,scope);
 if(u.pathname.startsWith('/api/marketing')){
 const pages:Record<string,AccessPage>={'/api/marketing/connections':'connections','/api/marketing/connected':'overview','/api/marketing/analytics':'analytics','/api/marketing/postiz':'posts','/api/marketing/postiz/media':'posts','/api/marketing/live':'work','/api/marketing':'work','/api/marketing/business':'business'};
 const page=pages[u.pathname];
 const metadataRead=u.pathname==='/api/marketing/business'&&r.method==='GET'&&can(user,scope,'analytics');
 if(!page||(!metadataRead&&!can(user,scope,page,!['GET','HEAD'].includes(r.method))))return json({error:'この事業・画面の操作は許可されていません。'},403);
 }
 if(u.pathname==='/api/marketing/connections')return connections(r,env,scope);
 if(u.pathname==='/api/marketing/connected')return connected(r,env,scope);
 if(u.pathname==='/api/marketing/analytics')return analytics(r,env,scope,permission(user,scope,'analytics')?.projects??null);
 if(u.pathname==='/api/marketing/business'){
 if(r.method==='GET'){
 const data=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;
 if(can(user,scope,'business'))return json({data});
 const projects=permission(user,scope,'analytics')?.projects??null;
 return json({data:{...emptyBusiness,version:data.version,projects:(data.projects??[]).filter(p=>projects===null||projects.includes(p.id)),funnels:(data.funnels??[]).filter(f=>projects===null||projects.includes(f.projectId))}});
 }
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 const b=await body(r),data=validateBusiness(b.data);if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||data.version!==b.expectedVersion)throw new PostizError('更新番号が不正です。','validation');const signature=await digest(JSON.stringify(b));data.version++;data.updatedAt=new Date().toISOString();return json({data:await commitDocument(env.DB,documentId(scope,'business'),b.expectedVersion,data,b.requestId,signature)});
 }
 if(u.pathname==='/api/marketing/postiz')return postiz(r,env,scope);
 if(u.pathname==='/api/marketing/postiz/media')return r.method==='GET'?json({assets:[]}):json({error:'クラウド版の素材アップロードは準備中です。'},503);
 if(u.pathname==='/api/marketing/live')return r.method==='GET'?json({jobs:[],policy:{enabled:false,remaining:0,attemptLimit:0,reserved:0}}):json({error:'クラウド版のAstra実行は未接続です。'},503);
 if(u.pathname==='/api/marketing')return r.method==='GET'?json({jobs:[],mode:'cloud',capabilities:{paidModelExecution:false,externalWrites:false}}):json({error:'クラウド版のAstra実行は未接続です。'},503);
 if(u.pathname.startsWith('/api/'))return json({error:'この機能は公開版にありません。'},404);
 if(!['GET','HEAD'].includes(r.method))return json({error:'操作できません。'},405);
 if(u.pathname==='/')return new Response(null,{status:303,headers:{Location:'/company'}});
 return env.ASSETS.fetch(r);
}
export default {scheduled:async(_event:unknown,env:Env)=>{await scheduled(env);await scheduledImprovements(env);},async fetch(r:Request,env:Env){let response:Response;try{response=await route(r,env);if(response.ok&&r.method==='POST'&&new URL(r.url).pathname.startsWith('/api/marketing/')&&new URL(r.url).pathname!=='/api/marketing/businesses'){const actor=await currentUser(r,env);if(actor)await audit(env,actor.id,'marketing.updated',new URL(r.url).pathname,{businessId:r.headers.get('X-Astra-Business')??'default'});}}catch(e){response=json({error:e instanceof Conflict||e instanceof PostizError?e.message:'処理できませんでした。再度お試しください。'},e instanceof Conflict?409:e instanceof PostizError||e instanceof SyntaxError?400:500);}const out=new Response(response.body,response);out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('X-Frame-Options','DENY');out.headers.set('Referrer-Policy','same-origin');out.headers.set('X-Robots-Tag','noindex, nofollow');out.headers.set('Cache-Control','private, no-store');return out;}};
