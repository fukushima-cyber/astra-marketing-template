import {DurableObject} from 'cloudflare:workers';
import type {Env} from './types';
import {tick} from './autonomy-engine';
import {usingDatabase} from './database-runtime';
export class AstraLoop extends DurableObject<Env>{
 private generation=0;
 private async scope(env:Env,requested?:string){
  if(env.DB_PROVIDER!=='supabase'){const previous=await this.ctx.storage.get('scope') as string|undefined;if(previous&&requested&&previous!==requested)throw new Error('事業が一致しません。');if(requested)await this.ctx.storage.put('scope',requested);return requested??previous;}
  const id=this.ctx.id.toString(),row=await env.DB.prepare('SELECT scope FROM scheduler_state WHERE id=?').bind(id).first<{scope:string}>();
  const legacy=await this.ctx.storage.get('scope') as string|undefined,scope=row?.scope??legacy??requested;
  if(row&&legacy&&row.scope!==legacy)throw new Error('事業が一致しません。');
  if(scope&&requested&&scope!==requested)throw new Error('事業が一致しません。');
  if(scope&&!row){const error=await this.ctx.storage.get('lastError');await env.DB.prepare('INSERT OR IGNORE INTO scheduler_state(id,scope,last_error,updated_at) VALUES(?,?,?,?)').bind(id,scope,error?JSON.stringify(error):null,Date.now()).run();}
  if(scope){const saved=await env.DB.prepare('SELECT scope FROM scheduler_state WHERE id=?').bind(id).first<{scope:string}>();if(saved?.scope!==scope)throw new Error('保存を確認できませんでした。');await this.ctx.storage.delete('scope');await this.ctx.storage.delete('lastError');}return scope;
 }
 async migrateState(){if(this.env.ASTRA_MIGRATION_ENABLED!=='1'||this.env.ASTRA_MAINTENANCE!=='1')throw new Error('Not available');return usingDatabase({...this.env,DB_PROVIDER:'supabase'},async env=>Boolean(await this.scope(env)));}
 async wake(scope:string){if(this.env.ASTRA_MAINTENANCE==='1')return;this.generation++;await usingDatabase(this.env,env=>this.scope(env,scope));await this.ctx.storage.setAlarm(Date.now()+1000);}
 async alarm(){
  if(this.env.ASTRA_MAINTENANCE==='1'){await this.ctx.storage.setAlarm(Date.now()+60000);return;}
  await usingDatabase(this.env,async env=>{const generation=this.generation,scope=await this.scope(env);if(!scope)return;await this.ctx.storage.setAlarm(Date.now()+180000);try{const next=await tick(env,scope);if(this.generation!==generation)await this.ctx.storage.setAlarm(Date.now()+1000);else if(next)await this.ctx.storage.setAlarm(next);else await this.ctx.storage.deleteAlarm();}catch(e){const error={at:Date.now(),message:e instanceof Error?e.message:'処理できませんでした。'};if(env.DB_PROVIDER==='supabase')await env.DB.prepare('UPDATE scheduler_state SET last_error=?,updated_at=? WHERE id=?').bind(JSON.stringify(error),Date.now(),this.ctx.id.toString()).run();else await this.ctx.storage.put('lastError',error);throw e;}});
 }
}
