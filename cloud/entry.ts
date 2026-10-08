import worker from './worker.ts';
import type {Env} from './types.ts';
import {usingDatabase} from './database-runtime.ts';
import {databaseMigration} from './database-migration.ts';
export {AstraLoop} from './autonomy-object';
export default {
 async fetch(request:Request,env:Env){
  const path=new URL(request.url).pathname;
  if(path==='/api/internal/database-migration')return databaseMigration(request,env);
  if(env.ASTRA_MAINTENANCE==='1'&&(!['GET','HEAD'].includes(request.method)||/^\/(login|join|logout|auth)(?:\/|$)/.test(path)))return Response.json({error:'データ移行中です。保存は完了後に再度お試しください。'},{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
  try{return await usingDatabase(env,runtime=>worker.fetch(request,runtime));}catch{return Response.json({error:'データベースに接続できません。再度お試しください。'},{status:503,headers:{'Cache-Control':'no-store'}});}
 },
 async scheduled(event:unknown,env:Env){if(env.ASTRA_MAINTENANCE==='1')return;await usingDatabase(env,runtime=>worker.scheduled(event,runtime));}
};
