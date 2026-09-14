import { validFunnelRegistry } from './funnels.ts';
import type { BusinessData } from './types.ts';
import { PostizError } from '../postiz/types.ts';
const fail=():never=>{throw new PostizError('入力内容・数値・期間を確認してください。','validation');};
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const text=(v:unknown,max=4000)=>typeof v==='string'&&v.length<=max;
export function validateBusiness(value:unknown):BusinessData{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();const d=value as BusinessData;
 if(!text(d.name,100)||!text(d.objective)||!Number.isSafeInteger(d.version)||d.version<0||!Array.isArray(d.goals)||!Array.isArray(d.observations)||!Array.isArray(d.campaigns)||d.goals.length>20||d.observations.length>1000||d.campaigns.length>1000)fail();
 for(const list of [d.goals,d.observations,d.campaigns])if(new Set(list.map(x=>x.id)).size!==list.length||list.some(x=>!text(x.id,100)||!x.id))fail();
 for(const g of d.goals)if(!Number.isSafeInteger(g.baselineDays)||g.baselineDays<1||g.baselineDays>366||typeof g.comparisonConfirmed!=='boolean'||(g.comparisonObservation!==undefined&&!text(g.comparisonObservation,20000))||!text(g.title,100)||!g.title.trim()||!['conversions','bookingRate','cpa','revenue','grossProfit'].includes(g.metric)||!Number.isFinite(g.baseline)||!Number.isFinite(g.target)||!date(g.deadline)||!text(g.owner,100)||!g.owner.trim()||!text(g.baselineSource)||!g.baselineSource.trim()||!['increase','decrease'].includes(g.direction))fail();
 for(const o of d.observations){if(!text(o.label,100)||!date(o.start)||!date(o.end)||o.start>o.end||!Number.isSafeInteger(o.days)||o.days<1||o.days>366||!text(o.source)||!o.source.trim()||!date(o.collectedAt))fail();for(const field of ['visitors','registrations','bookings','meetings','conversions','adSpend','revenue','grossProfit'] as const){const n=o[field];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||(field!=='grossProfit'&&n<0)))fail();if(['visitors','registrations','bookings','meetings','conversions'].includes(field)&&n!==null&&!Number.isSafeInteger(n))fail();}}
 for(const c of d.campaigns)if((c.phase!==undefined&&!['planned','running','observing','review','done'].includes(c.phase))||(c.assignee!==undefined&&!text(c.assignee,100))||!text(c.title,100)||!c.title.trim()||!d.goals.some(g=>g.id===c.goalId)||![c.hypothesis,c.change,c.comparison,c.stopRule,c.reason,c.source].every(v=>text(v))||!date(c.start)||!date(c.end)||c.start>c.end||!['pending','continue','change','stop'].includes(c.result)||!Array.isArray(c.postIds)||c.postIds.some(id=>!text(id,100)))fail();
 if(!validFunnelRegistry(d.projects??[],d.funnels??[],d.goals.map(g=>g.id)))fail();
 if(d.campaigns.some(c=>c.funnelId&&!d.funnels?.some(f=>f.id===c.funnelId&&f.goalIds.includes(c.goalId))))fail();
 return structuredClone(d);
}
