import type {Env} from './types.ts';
import type {Policy,JobData} from '../lib/autonomy/model.ts';
import type {Identity} from '../lib/access.ts';
export type Settings={business_id:string;owner_id:string;version:number;policy:string;next_at:number|null;lease:string|null;lease_until:number|null;model:string;credential:string};
export type Job={id:string;business_id:string;status:string;policy_version:number;data:string;created_at:string};
export async function settings(env:Env,scope:string){return env.DB.prepare('SELECT * FROM autonomy_settings WHERE business_id=?').bind(scope).first<Settings>();}
export async function ownerIdentity(env:Env,s:Settings):Promise<Identity>{const row=await env.DB.prepare("SELECT u.id,u.company_id AS companyId,u.name,u.email,u.role,u.version FROM users u JOIN businesses b ON b.company_id=u.company_id WHERE u.id=? AND b.id=? AND u.active=1 AND u.role='owner'").bind(s.owner_id,s.business_id).first<Identity>();if(!row)throw new Error('任せた管理者の権限を確認できません。');return {...row,grants:[]};}
export async function finishJob(env:Env,j:Job,d:JobData,status:string,nextAt:number|null){d.nextAt=nextAt;await env.DB.batch([env.DB.prepare('UPDATE autonomy_jobs SET status=?,data=?,updated_at=? WHERE id=?').bind(status,JSON.stringify(d),new Date().toISOString(),j.id),env.DB.prepare('UPDATE autonomy_settings SET next_at=? WHERE business_id=? AND version=?').bind(nextAt,j.business_id,j.policy_version)]);}
export const policy=(s:Settings)=>JSON.parse(s.policy) as Policy;
