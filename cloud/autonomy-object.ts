import {DurableObject} from 'cloudflare:workers';
import type {Env} from './types';
import {tick} from './autonomy-engine';
export class AstraLoop extends DurableObject<Env>{
 private generation=0;
 async wake(scope:string){this.generation++;const previous=await this.ctx.storage.get('scope');if(previous&&previous!==scope)throw new Error('事業が一致しません。');await this.ctx.storage.put('scope',scope);await this.ctx.storage.setAlarm(Date.now()+1000);}
 async alarm(){const generation=this.generation;const scope=await this.ctx.storage.get('scope');if(!scope)return;await this.ctx.storage.setAlarm(Date.now()+180000);try{const next=await tick(this.env,scope);if(this.generation!==generation)await this.ctx.storage.setAlarm(Date.now()+1000);else if(next)await this.ctx.storage.setAlarm(next);else await this.ctx.storage.deleteAlarm();}catch(e){await this.ctx.storage.put('lastError',{at:Date.now(),message:e instanceof Error?e.message:'処理できませんでした。'});throw e;}}
}
