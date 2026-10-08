import type {Env} from './types.ts';
import {digest} from './storage.ts';
import {pageNames,type Identity,type Grant} from '../lib/access.ts';
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const cookie=(r:Request,name:string)=>r.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1)??'';
export async function currentUser(r:Request,env:Env):Promise<Identity|null>{
 const token=cookie(r,'__Host-astra-user');if(!/^[a-f0-9]{64}$/.test(token))return null;
 type Row=Omit<Identity,'grants'>&{businessId:string|null;page:Grant['page']|null;edit:number|null;projects:string|null};
 const rows=(await env.DB.prepare('SELECT u.id,u.company_id AS companyId,u.name,u.email,u.role,u.version,g.business_id AS businessId,g.page,g.edit,g.projects FROM user_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN access_grants g ON g.user_id=u.id WHERE s.token_hash=? AND s.expires>? AND u.active=1 AND s.version=u.version').bind(await digest(token),Date.now()).all<Row>()).results;
 if(!rows.length)return null;
 const {businessId:_businessId,page:_page,edit:_edit,projects:_projects,...user}=rows[0];
 const grants=rows.flatMap(row=>row.businessId&&row.page?[{businessId:row.businessId,page:row.page,edit:row.edit===1,projects:JSON.parse(row.projects??'null')}]:[]);
 return {...user,grants};
}
export async function newSession(env:Env,userId:string){await env.DB.prepare('DELETE FROM user_sessions WHERE expires<=?').bind(Date.now()).run();const token=randomToken();await env.DB.prepare('INSERT INTO user_sessions(token_hash,user_id,version,expires) SELECT ?,id,version,? FROM users WHERE id=? AND active=1').bind(await digest(token),Date.now()+7*86400000,userId).run();return `__Host-astra-user=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;}
export async function audit(env:Env,actor:string|null,action:string,target:string,detail:unknown={}){await env.DB.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'company',actor,action,target,JSON.stringify(detail),new Date().toISOString()).run();}
export const normalizeEmail=(email:unknown)=>typeof email==='string'?email.trim().toLowerCase():'';
export const validEmail=(email:string)=>email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export async function validateGrants(env:Env,input:unknown):Promise<Grant[]>{
 if(!Array.isArray(input)||input.length>600)throw new Error('権限の指定を確認してください。');
 const businesses=(await env.DB.prepare("SELECT id FROM businesses WHERE company_id='company' AND archived_at IS NULL").all<{id:string}>()).results;const seen=new Set<string>();
 const grants:Grant[]=[];
 for(const g of input){
 if(!g||typeof g.businessId!=='string'||!businesses.some(b=>b.id===g.businessId)||!Object.hasOwn(pageNames,g.page)||typeof g.edit!=='boolean'||!(g.projects===null||Array.isArray(g.projects)&&g.projects.length>0&&g.projects.length<=100&&g.projects.every((p:unknown)=>typeof p==='string'&&p.length<150)))throw new Error('権限の指定を確認してください。');
 if(g.projects!==null&&(g.page!=='analytics'||g.edit))throw new Error('案件を限定する場合は詳細分析の閲覧権限を選んでください。');
 const key=g.businessId+':'+g.page;if(seen.has(key))throw new Error('権限が重複しています。');seen.add(key);
 if(g.projects!==null){const id=g.businessId==='default'?'business':g.businessId+':business';const row=await env.DB.prepare('SELECT data FROM documents WHERE id=?').bind(id).first<{data:string}>();const ids=(row?JSON.parse(row.data)?.projects??[]:[]).map((p:{id:string})=>p.id);if(g.projects.some((p:string)=>!ids.includes(p)))throw new Error('この事業にない案件が指定されています。');}
 grants.push({businessId:g.businessId,page:g.page,edit:g.edit,projects:g.projects===null?null:[...new Set(g.projects)] as string[]});
 }
 return grants;
}
