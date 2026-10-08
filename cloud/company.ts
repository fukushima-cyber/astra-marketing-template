import type {Env} from './types.ts';
import type {CompanyMetrics,CompanyDay} from '../lib/company.ts';
import {can,permission,type Identity} from '../lib/access.ts';
import {audit,normalizeEmail,randomToken,validateGrants,validEmail} from './identity.ts';
import {digest,readDocument} from './storage.ts';
import {documentId} from './business-scope.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {validDate} from '../lib/analytics/model.ts';
import {businessColumns,decodeBusiness,isBusinessKind,type BusinessSummary} from '../lib/business.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status});
export async function visibleBusinesses(env:Env,user:Identity){const rows=(await env.DB.prepare(`SELECT ${businessColumns},created_at FROM businesses WHERE company_id=? AND archived_at IS NULL ORDER BY created_at,id`).bind(user.companyId).all<BusinessSummary&{created_at:string}>()).results.map(decodeBusiness);return user.role==='owner'?rows:rows.filter(b=>user.grants.some(g=>g.businessId===b.id));}
export async function company(r:Request,env:Env,user:Identity){
 if(r.method!=='GET')return json({error:'操作できません。'},405);
 const q=new URL(r.url).searchParams,today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}),start=q.get('start')??today.slice(0,7)+'-01',end=q.get('end')??today,kind=q.get('kind');
 if(!validDate(start)||!validDate(end)||start>end||kind!==null&&!isBusinessKind(kind))return json({error:'期間または事業種別を確認してください。'},400);
 const profile=await env.DB.prepare('SELECT id,name FROM companies WHERE id=?').bind(user.companyId).first();
 const rows=[];
 for(const b of (await visibleBusinesses(env,user)).filter(b=>kind===null||b.kind===kind)){
 const access=permission(user,b.id,'analytics');const projects=access?.projects??null;
 let metrics:CompanyMetrics|null=null;
 let daily:CompanyDay[]|null=null;
 if(access){
 const sql="SELECT count(*) AS records,count(DISTINCT date) AS days,count(DISTINCT json_extract(data,'$.definition')) AS definitions,MAX(date) AS latest, SUM(json_extract(data,'$.values.revenue')) AS revenue,SUM(json_extract(data,'$.values.payments')) AS payments,SUM(json_extract(data,'$.values.refunds')) AS refunds,SUM(json_extract(data,'$.values.cost')) AS cost,SUM(json_extract(data,'$.values.sales')) AS sales,SUM(json_extract(data,'$.values.registrations')) AS registrations,COUNT(json_extract(data,'$.values.revenue')) AS revenueCount,COUNT(json_extract(data,'$.values.payments')) AS paymentsCount,COUNT(json_extract(data,'$.values.refunds')) AS refundsCount,COUNT(json_extract(data,'$.values.cost')) AS costCount,COUNT(json_extract(data,'$.values.sales')) AS salesCount,COUNT(json_extract(data,'$.values.registrations')) AS registrationsCount FROM analytics_rows WHERE business_id=? AND date>=? AND date<=? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?)))";
 metrics=await env.DB.prepare(sql).bind(b.id,start,end,projects===null?null:JSON.stringify(projects),JSON.stringify(projects)).first<CompanyMetrics>();
 daily=(await env.DB.prepare(sql.replace('SELECT count(*)', 'SELECT date,count(*)')+' GROUP BY date ORDER BY date').bind(b.id,start,end,projects===null?null:JSON.stringify(projects),JSON.stringify(projects)).all<CompanyDay>()).results;
 }
 const data=can(user,b.id,'business')?(await readDocument(env.DB,documentId(b.id,'business'),emptyBusiness)).data:null;
 rows.push({...b,metrics,daily,restrictedProjects:projects!==null,objective:data?.objective??null,goals:data?.goals??[],pendingImprovements:data?.campaigns.filter(c=>c.result==='pending').length??null,updatedAt:data?.updatedAt??null});
 }
 return json({company:profile,businesses:rows,start,end,scope:user.role==='owner'?'company':'permitted',astra:{enabled:false,reason:'モデル実行・外部変更・自動評価は未接続です。'}});
}
export async function owner(r:Request,env:Env,user:Identity){
 if(user.role!=='owner')return json({error:'全体管理者だけが操作できます。'},403);
 if(r.method==='GET'){
 const members=(await env.DB.prepare('SELECT id,email,name,role,active,version,created_at FROM users WHERE company_id=? ORDER BY created_at').bind(user.companyId).all()).results;
 const grants=(await env.DB.prepare('SELECT g.user_id,g.business_id AS businessId,g.page,g.edit,g.projects FROM access_grants g JOIN users u ON u.id=g.user_id WHERE u.company_id=?').bind(user.companyId).all<{user_id:string;businessId:string;page:string;edit:number;projects:string}>()).results.map(g=>({...g,edit:g.edit===1,projects:JSON.parse(g.projects)}));
 const invitations=(await env.DB.prepare('SELECT token_hash AS id,email,role,kind,expires,used_by,revoked,created_at FROM invitations WHERE company_id=? ORDER BY created_at DESC LIMIT 100').bind(user.companyId).all()).results;
 const history=(await env.DB.prepare('SELECT a.id,a.actor_id,u.name AS actor_name,a.action,a.target,a.detail,a.created_at FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.company_id=? ORDER BY a.created_at DESC LIMIT 100').bind(user.companyId).all()).results;
 const businesses=await visibleBusinesses(env,user),projects=[];for(const b of businesses){const data=(await readDocument(env.DB,documentId(b.id,'business'),emptyBusiness)).data;projects.push(...(data.projects??[]).map(p=>({id:p.id,name:p.name,businessId:b.id})));}
 return json({members,grants,invitations,history,businesses,projects});
 }
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 let b;try{const raw=await r.text();if(raw.length>100000)throw new Error();b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();}catch{return json({error:'入力を確認してください。'},400);}
 if(b.action==='invite'||b.action==='reset'){
 const email=normalizeEmail(b.email);if(!validEmail(email))return json({error:'招待するメールアドレスを確認してください。'},400);
 const target=await env.DB.prepare('SELECT id,role,active FROM users WHERE email=? AND company_id=?').bind(email,user.companyId).first<{id:string;role:string;active:number}>();
 if(b.action==='invite'&&target||b.action==='reset'&&(!target||!target.active||target.role==='owner'))return json({error:'登録済み・停止中、または対象外のアカウントです。'},400);
 let grants;try{grants=b.action==='invite'?await validateGrants(env,b.grants):[];}catch(e){return json({error:(e as Error).message},400);}
 const token=randomToken(),hash=await digest(token),expires=Date.now()+48*3600000;
 await env.DB.batch([
 env.DB.prepare('UPDATE invitations SET revoked=1 WHERE company_id=? AND email=? AND used_by IS NULL').bind(user.companyId,email),
 env.DB.prepare('INSERT INTO invitations(token_hash,company_id,email,role,grants,kind,target_id,expires,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(hash,user.companyId,email,'member',JSON.stringify(grants),b.action==='reset'?'reset':'enroll',target?.id??null,expires,user.id,new Date().toISOString()),
 ]);
 await audit(env,user.id,b.action==='reset'?'member.reset_link':'member.invited',email,{grants,expires});
 return json({url:new URL('/join#token='+token,r.url).href,expires});
 }
 if(b.action==='revokeInvite'){
 if(typeof b.id!=='string')return json({error:'招待を選んでください。'},400);
 await env.DB.prepare('UPDATE invitations SET revoked=1 WHERE token_hash=? AND company_id=? AND role!=? AND used_by IS NULL').bind(b.id,user.companyId,'owner').run();await audit(env,user.id,'invitation.revoked',b.id);return json({ok:true});
 }
 if(b.action==='member'){
 const target=await env.DB.prepare('SELECT id,role,active,version FROM users WHERE id=? AND company_id=?').bind(typeof b.id==='string'?b.id:'',user.companyId).first<{id:string;role:string;active:number;version:number}>();
 if(!target||target.role==='owner')return json({error:'全体管理者の権限はこの画面から変更できません。'},403);
 if(!Number.isSafeInteger(b.version)||typeof b.active!=='boolean')return json({error:'更新情報を確認してください。'},400);
 let grants;try{grants=await validateGrants(env,b.grants);}catch(e){return json({error:(e as Error).message},400);}
 const marker=crypto.randomUUID(),old=(await env.DB.prepare('SELECT business_id,page,edit,projects FROM access_grants WHERE user_id=?').bind(target.id).all()).results;
 await env.DB.batch([
 env.DB.prepare('UPDATE users SET active=?,version=version+1,mutation_id=? WHERE id=? AND version=?').bind(b.active?1:0,marker,target.id,b.version),
 env.DB.prepare('DELETE FROM access_grants WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_id=?)').bind(target.id,target.id,marker),
 env.DB.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) SELECT ?,json_extract(value,'$.businessId'),json_extract(value,'$.page'),json_extract(value,'$.edit'),COALESCE(json_extract(value,'$.projects'),'null') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_id=?)").bind(target.id,JSON.stringify(grants),target.id,marker),
 env.DB.prepare('DELETE FROM user_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_id=?)').bind(target.id,target.id,marker),
 env.DB.prepare('UPDATE invitations SET revoked=1 WHERE target_id=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_id=?)').bind(target.id,target.id,marker),
 env.DB.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,target,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_id=?)').bind(crypto.randomUUID(),user.companyId,user.id,'member.updated',target.id,JSON.stringify({before:{active:target.active,grants:old},after:{active:b.active,grants}}),new Date().toISOString(),target.id,marker),
 ]);
 const changed=await env.DB.prepare('SELECT mutation_id FROM users WHERE id=?').bind(target.id).first<{mutation_id:string}>();
 return changed?.mutation_id===marker?json({ok:true}):json({error:'別の画面で変更されています。再取得してください。'},409);
 }
 if(b.action==='companyName'){
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)return json({error:'会社名を確認してください。'},400);
 await env.DB.prepare('UPDATE companies SET name=? WHERE id=?').bind(b.name.trim(),user.companyId).run();await audit(env,user.id,'company.renamed',user.companyId);return json({ok:true});
 }
 return json({error:'操作が見つかりません。'},400);
}
