import type {Env,Statement} from './types.ts';
import type {Connection} from './native.ts';
import type {Page,Day} from '../lib/connected/model.ts';
import {daysIn} from '../lib/ads/reporting.ts';
export function pageStatements(env:Env,c:Connection,target:string,start:string,end:string,pages:Page[],at:string):Statement[]{
 return daysIn(start,end).map(day=>env.DB.prepare('INSERT INTO native_snapshots(business_id,connection_id,resource_id,day,data,collected_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM native_connections WHERE id=? AND credential=?) ON CONFLICT(connection_id,resource_id,day) DO UPDATE SET data=excluded.data,collected_at=excluded.collected_at WHERE excluded.collected_at>=native_snapshots.collected_at').bind(c.business_id,c.id,'pages:'+target,day,JSON.stringify(pages.map(p=>({...p,daily:p.daily.filter(d=>d.date===day)}))),at,c.id,c.credential));
}
export async function cachedPages(env:Env,c:Connection,target:string,start:string,end:string){
 const rows=(await env.DB.prepare('SELECT day,data,collected_at FROM native_snapshots WHERE business_id=? AND connection_id=? AND resource_id=? AND day>=? AND day<=? ORDER BY day').bind(c.business_id,c.id,'pages:'+target,start,end).all<{day:string;data:string;collected_at:string}>()).results;
 if(!rows.length)return null;
 const map=new Map<string,Page>();
 for(const r of rows)for(const p of JSON.parse(r.data) as Page[]){const old=map.get(p.id);map.set(p.id,{...p,daily:[...(old?.daily??[]),...p.daily]});}
 const complete=rows.length===daysIn(start,end).length;
 const fields=['pv','registrations','sales','revenue'] as const;
 const pages=[...map.values()].map(p=>({...p,totals:{uu:null,...Object.fromEntries(fields.map(k=>[k,complete&&p.daily.length&&p.daily.every(d=>d[k]!==null)?p.daily.reduce((n,d)=>n+d[k]!,0):null]))} as Omit<Day,'date'>}));
 return {pages,failures:[{funnelId:target,message:'最新取得に失敗、または収集停止中です。保存済みの明細を表示しています。'}],cached:true,coverage:rows.map(r=>r.day),collectedAt:rows.map(r=>r.collected_at).sort()[0]};
}

