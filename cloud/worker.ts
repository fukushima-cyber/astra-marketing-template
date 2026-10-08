import {trackingDiagnostics} from './tracking-diagnostics.ts';
import {mcp} from './mcp.ts';
import type {Identity} from '../lib/access.ts';
import {timeline} from './timeline.ts';
import {history as savedHistory} from './history.ts';
import {savedViews} from './saved-views.ts';
import {journey,ingestJourney,tracker} from './journey.ts';
import {measurement} from './measurement.ts';
import {dataExport} from './data-export.ts';
import {agentSkills} from './agent-skills.ts';
import {autonomy} from './autonomy.ts';
import {ads} from './ads.ts';
import {adReporting} from './ad-reporting.ts';
import {improvements} from './improvements.ts';
import {scheduledImprovements} from './improvement-schedule.ts';
import {commerce} from './commerce.ts';
import {planning} from './planning.ts';
import {whiteboard} from './whiteboard.ts';
import {connections,scheduled} from './native.ts';
import {documentId,resolveBusiness,businesses} from './business-scope.ts';
import { connected } from './connected.ts';
import { analytics } from './analytics.ts';
import type { Env } from './types.ts';
import {googleConfigured,login,loginPage,authPage,authScript,googleCallback,googleStart,logout,sameOrigin} from './auth.ts';
import {currentUser,audit} from './identity.ts';
import {legalPage} from './legal.ts';
import {company,owner,visibleBusinesses} from './company.ts';
import {can,permission,type AccessPage} from '../lib/access.ts';
import { commitDocument,Conflict,digest,readDocument } from './storage.ts';
import { validateBusiness } from '../lib/marketing-business/validate.ts';
import { emptyBusiness } from '../lib/marketing-business/types.ts';
import { PostizError,type PostizDraft } from '../lib/postiz/types.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function body(r:Request){const text=await r.text();if(new TextEncoder().encode(text).length>900000)throw new PostizError('入力が大きすぎます。','validation');const b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.requestId!=='string'||!b.requestId.trim()||b.requestId.length>200||'companyId'in b)throw new PostizError('操作情報が不正です。','validation');return b;}
async function postiz(r:Request,env:Env,scope='default'){const u=new URL(r.url),docId=documentId(scope,'drafts'),doc=await readDocument<PostizDraft[]>(env.DB,docId,[]);if(r.method==='GET'){const action=u.searchParams.get('action');if(action==='drafts')return json({drafts:doc.data});if(action==='status')return json({configured:false,reason:'クラウド版のPostiz実接続は未設定です。'});return json({error:'Postiz実接続は未設定です。'},503);}const b=await body(r),signature=await digest(JSON.stringify(b));const newId='draft-'+(await digest(b.requestId)).slice(0,32);const replay=await env.DB.prepare('SELECT signature FROM receipts WHERE id = ?').bind(docId+':'+b.requestId).first<{signature:string}>();if(replay){if(replay.signature!==signature)throw new Conflict('操作識別子が競合しています。');return json({draft:doc.data.find(d=>d.id===(b.action==='save'?(b.draft?.id??newId):(b.draftId??newId)))});}let draft:PostizDraft;
 if(b.action==='save'){
 const d=b.draft;if(!d||typeof d.title!=='string'||!d.title.trim()||d.title.length>100||typeof d.content!=='string'||!d.content.trim()||d.content.length>4000||typeof d.goalId!=='string'||!d.goalId||!['x','threads','instagram','youtube'].includes(d.platform)||d.assetIds?.length||d.options?.thumbnailId)throw new PostizError('題名・本文・目標・SNSを確認してください。素材はクラウド版に未接続です。','validation');
 const business=await readDocument<{goals:{id:string}[]}>(env.DB,documentId(scope,'business'),{goals:[]});if(!business.data.goals.some(g=>g.id===d.goalId))throw new PostizError('この事業に登録された目標を選んでください。','validation');
 const old=d.id?doc.data.find(x=>x.id===d.id):undefined;if(d.id&&(!old||old.version!==b.expectedVersion))throw new Conflict('下書きが更新されています。再取得してください。');
 if(d.scheduleAt!==undefined&&(typeof d.scheduleAt!=='string'||!Number.isFinite(Date.parse(d.scheduleAt))))throw new PostizError('日時が不正です。','validation');
 const now=new Date().toISOString();draft={id:old?.id??newId,version:(old?.version??0)+1,title:d.title,content:d.content,goalId:d.goalId,platform:d.platform,assetIds:[],options:d.options??{},scheduleAt:d.scheduleAt,createdAt:old?.createdAt??now,updatedAt:now,remotePostIds:[],syncStatus:'local',reviewState:'editing'};
 }else if(b.action==='review'){
 const old=doc.data.find(x=>x.id===b.draftId);if(!old||old.version!==b.expectedVersion)throw new Conflict('下書きが更新されています。');if(!['pending','changes','rejected'].includes(b.state)||typeof b.note!=='string'||b.note.length>2000)throw new PostizError('確認内容が不正です。','validation');draft={...old,version:old.version+1,reviewState:b.state,reviewNote:b.note,updatedAt:new Date().toISOString()};
 }else return json({error:'クラウド版のSNS実投稿は未接続です。'},503);
 const next=[...doc.data.filter(d=>d.id!==draft.id),draft];await commitDocument(env.DB,docId,doc.version,next,b.requestId,signature);return json({draft});
}
async function route(r:Request,env:Env,mcpUser?:Identity):Promise<Response>{const u=new URL(r.url);
 if(u.pathname==='/mcp')return mcp(r,env,(request,user)=>route(request,env,user));
 if(u.pathname==='/login'){if(r.method==='GET'){if(await currentUser(r,env))return new Response(null,{status:303,headers:{Location:'/company','Cache-Control':'no-store'}});if(googleConfigured(env)&&u.searchParams.get('signedOut')!=='1')return googleStart(r,env);return loginPage(env,u.searchParams.get('signedOut')==='1'?'ログアウトしました。':'');}if(r.method==='POST')return login(r,env);return json({error:'操作できません。'},405);}
 if(u.pathname==='/auth/google'&&r.method==='GET')return googleStart(r,env);
 if(u.pathname==='/auth/google/callback'&&r.method==='GET')return googleCallback(r,env);
 if(u.pathname==='/privacy'&&r.method==='GET')return legalPage('privacy');
 if(u.pathname==='/terms'&&r.method==='GET')return legalPage('terms');
 if(u.pathname==='/join'){if(r.method==='GET')return authPage('join','',200,googleConfigured(env));if(r.method==='POST')return login(r,env,true);return json({error:'操作できません。'},405);}
 if(u.pathname==='/auth-form.js'&&r.method==='GET')return authScript();
 if(u.pathname.startsWith('/_next/static/')&&['GET','HEAD'].includes(r.method))return env.ASSETS.fetch(r);
 if(u.pathname==='/track.js'&&r.method==='GET')return tracker(r);
 if(u.pathname==='/api/ingest/journey')return ingestJourney(r,env);
 const user=mcpUser??await currentUser(r,env);
 if(!user){if(u.pathname.startsWith('/api/'))return json({error:'ログインしてください。'},401);return new Response(null,{status:303,headers:{Location:'/login','Cache-Control':'no-store'}});}
 if(!['GET','HEAD'].includes(r.method)&&!sameOrigin(r))return json({error:'接続元が一致しません。'},403);
 if(u.pathname==='/logout'&&r.method==='POST')return logout(r,env);
 if(u.pathname==='/api/me'&&r.method==='GET')return json({user,...(u.searchParams.get('include')==='businesses'?{businesses:await visibleBusinesses(env,user)}:{})});
 if(u.pathname==='/api/company')return company(r,env,user);
 if(u.pathname==='/api/owner')return owner(r,env,user);
 if(/^\/owner(?:\/|\.|$)/.test(u.pathname)&&user.role!=='owner')return new Response('この画面は全体管理者専用です。',{status:403});
 if(u.pathname==='/api/marketing/businesses'){
 if(r.method==='GET')return user.role==='owner'&&u.searchParams.get('include')==='all'?businesses(r,env):json({businesses:await visibleBusinesses(env,user)});
 if(user.role!=='owner')return json({error:'事業の追加・変更は全体管理者が行います。'},403);
 const result=await businesses(r,env);if(result.ok)await audit(env,user.id,'business.updated','businesses');return result;
 }
 const businessScope=u.pathname.startsWith('/api/marketing')?await resolveBusiness(r,env):null;
 if(u.pathname.startsWith('/api/marketing')&&(!businessScope||businessScope.companyId!==user.companyId||user.role!=='owner'&&!user.grants.some(g=>g.businessId===businessScope.id)))return json({error:'事業が見つかりません。事業を選び直してください。'},404);
 const scope=businessScope?.id??'default';
 if(u.pathname==='/api/marketing/data-export')return dataExport(r,env,user,scope);
 if(u.pathname==='/api/marketing/agent-skills')return agentSkills(r,env,user,scope);
 if(u.pathname==='/api/marketing/autonomy')return autonomy(r,env,user,scope);
 if(u.pathname==='/api/marketing/timeline')return timeline(r,env,user,scope);
 if(u.pathname==='/api/marketing/history')return savedHistory(r,env,user,scope);
 if(u.pathname==='/api/marketing/saved-views')return savedViews(r,env,user,scope);
 if(u.pathname==='/api/marketing/journey')return journey(r,env,user,scope);
 if(u.pathname==='/api/marketing/tracking-diagnostics')return trackingDiagnostics(r,env,user,scope);
 if(u.pathname==='/api/marketing/measurement')return measurement(r,env,user,scope);
 if(u.pathname==='/api/marketing/ad-reporting')return adReporting(r,env,user,scope);
 if(u.pathname==='/api/marketing/ads')return ads(r,env,user,scope);
 if(u.pathname==='/api/marketing/improvements')return improvements(r,env,user,scope);
 if(u.pathname==='/api/marketing/commerce')return commerce(r,env,user,scope);
 if(u.pathname==='/api/marketing/plan')return planning(r,env,user,scope);
 if(u.pathname==='/api/marketing/whiteboard')return whiteboard(r,env,user,scope);
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
 const b=await body(r),data=validateBusiness(b.data);if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||data.version!==b.expectedVersion)throw new PostizError('更新番号が不正です。','validation');const old=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data;for(const c of data.campaigns){const prior=old.campaigns.find(v=>v.id===c.id);if(JSON.stringify(c.evidence)!==JSON.stringify(prior?.evidence))throw new PostizError('分析の根拠は施策画面から引き継ぎ、保存後は変更できません。','validation');}const signature=await digest(JSON.stringify(b));data.version++;data.updatedAt=new Date().toISOString();return json({data:await commitDocument(env.DB,documentId(scope,'business'),b.expectedVersion,data,b.requestId,signature)});
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
export default {scheduled:async(_event:unknown,env:Env)=>{await scheduled(env);await scheduledImprovements(env);},async fetch(r:Request,env:Env){let response:Response;const path=new URL(r.url).pathname;try{response=await route(r,env);if(response.ok&&r.method==='POST'&&path.startsWith('/api/marketing/')&&path!=='/api/marketing/businesses'){const actor=await currentUser(r,env);if(actor)await audit(env,actor.id,'marketing.updated',path,{businessId:r.headers.get('X-Astra-Business')??'default'});}}catch(e){response=json({error:e instanceof Conflict||e instanceof PostizError?e.message:'処理できませんでした。再度お試しください。'},e instanceof Conflict?409:e instanceof PostizError||e instanceof SyntaxError?400:500);}const out=new Response(response.body,response);out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('X-Frame-Options','DENY');out.headers.set('Referrer-Policy','same-origin');out.headers.set('X-Robots-Tag','noindex, nofollow');out.headers.set('Cache-Control',response.ok&&path.startsWith('/_next/static/')?'public, max-age=31536000, immutable':'private, no-store');return out;}};
