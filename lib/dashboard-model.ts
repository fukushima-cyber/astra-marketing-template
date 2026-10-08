import type {ChartPoint} from './chart-model.ts';
import {aggregate,type Entity,type Report} from './ads/model.ts';
export function donutParts(points:ChartPoint[]){
 const missing=points.some(p=>p.value===null||!Number.isFinite(p.value)||p.partial),invalid=points.some(p=>p.value!==null&&p.value<0);
 const parts=points.filter((p):p is ChartPoint&{value:number}=>p.value!==null&&Number.isFinite(p.value)&&p.value>0);
 return {parts,total:parts.reduce((n,p)=>n+p.value,0),missing,invalid};
}
export function creativeRanking(entities:Entity[],reports:Report[],action:string,minimum=5){
 if(!action)return [];
 const ids=[...new Set(reports.map(r=>r.adId))];
 return ids.map(id=>{const rows=reports.filter(r=>r.adId===id),metrics=aggregate(rows,action);return {id,name:rows[0].adName,entity:entities.find(e=>e.level==='ad'&&e.id===id),rows,...metrics};})
 .filter(r=>r.results!==null&&r.results>=minimum&&r.spend!==null&&r.spend>0&&r.cpa!==null)
 .sort((a,b)=>a.cpa!-b.cpa!||b.results!-a.results!||a.id.localeCompare(b.id)).slice(0,5);
}
export function creativeImageUrl(raw:unknown):string|undefined{
 if(typeof raw!=='string'||raw.length>4000)return;
 try{const u=new URL(raw);if(u.protocol==='https:'&&!u.searchParams.has('access_token')&&!u.username&&!u.password&&(u.hostname.endsWith('.fbcdn.net')||u.hostname.endsWith('.fbsbx.com')))return u.href;}catch{}
}
