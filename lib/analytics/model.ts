import {acquisitionChannelNames,type AcquisitionChannel} from '../business.ts';
import type { BusinessData } from '../marketing-business/types.ts';
import type { ProjectFunnel } from '../marketing-business/funnels.ts';
export const measures={cost:'広告費',revenue:'確定売上',payments:'入金',refunds:'返金',registrations:'登録件数',sales:'成約件数'} as const;
export type Measure=keyof typeof measures;
export type Fact={id:string;source:string;externalId:string;date:string;projectId:string;funnelId:string;sourceType:AcquisitionChannel;platform:string;content:string;angle:string;format:string;definition:string;collectedAt:string;values:Record<Measure,number|null>;stageCounts:Record<string,number|null>;funnel:ProjectFunnel};
export type FactInput=Omit<Fact,'id'|'funnel'>;
export type Filter={start:string;end:string;projectId:string;sourceType:string;platform:string;funnelId:string};
export type Axis='projectId'|'platform'|'funnelId'|'content'|'angle'|'format'|'date'|'sourceType';
export const axisNames:Record<Axis,string>={projectId:'プロジェクト',platform:'媒体',funnelId:'ファネル',content:'投稿・広告',angle:'訴求',format:'形式',date:'日付',sourceType:'流入区分'};
export const validDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const text=(v:unknown,max=500):v is string=>typeof v==='string'&&v.length<=max;
export function validateFact(input:unknown,business:BusinessData):FactInput{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('実績の形式が不正です。');const v=input as FactInput;
 if(!text(v.source,100)||!v.source.trim()||!text(v.externalId,150)||!v.externalId.trim()||!validDate(v.date)||!validDate(v.collectedAt)||v.collectedAt<v.date||!business.projects?.some(p=>p.id===v.projectId))throw new Error('出典・元データID・日付・プロジェクトを確認してください。');
 const funnel=business.funnels?.find(f=>f.id===v.funnelId&&f.projectId===v.projectId);
 if(!funnel||!Object.hasOwn(acquisitionChannelNames,v.sourceType)||funnel.source!==v.sourceType||!text(v.platform,100)||!v.platform.trim()||!text(v.content,200)||!text(v.angle,200)||!text(v.format,100)||!text(v.definition,2000)||!v.definition.trim())throw new Error('ファネル・媒体・集計定義を確認してください。');
 if(!v.values||typeof v.values!=='object'||Array.isArray(v.values))throw new Error('実績値が不正です。');
 const values={} as Fact['values'];for(const key of Object.keys(measures) as Measure[]){const n=v.values[key];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e12||(['registrations','sales'].includes(key)&&!Number.isSafeInteger(n))))throw new Error('実績は0以上、未取得は空欄にしてください。');values[key]=n;}
 if(!v.stageCounts||typeof v.stageCounts!=='object'||Array.isArray(v.stageCounts)||Object.keys(v.stageCounts).some(id=>!funnel.stages.some(s=>s.id===id)))throw new Error('ファネルの段階が一致しません。');
 const stageCounts:Fact['stageCounts']={};for(const [id,n] of Object.entries(v.stageCounts)){if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>1e12))throw new Error('段階の件数が不正です。');stageCounts[id]=n;}
 return {source:v.source,externalId:v.externalId,date:v.date,collectedAt:v.collectedAt,projectId:v.projectId,funnelId:v.funnelId,sourceType:v.sourceType,platform:v.platform,content:v.content,angle:v.angle,format:v.format,definition:v.definition,values,stageCounts};
}
export function matches(f:Fact,q:Filter){return f.date>=q.start&&f.date<=q.end&&(!q.projectId||f.projectId===q.projectId)&&(!q.sourceType||f.sourceType===q.sourceType)&&(!q.platform||f.platform===q.platform)&&(!q.funnelId||f.funnelId===q.funnelId);}
export function total(rows:Fact[],key:Measure){const observed=rows.filter(r=>r.values[key]!==null);return {value:observed.length?observed.reduce((n,r)=>n+r.values[key]!,0):null,missing:rows.length-observed.length,count:rows.length};}
export function ratio(rows:Fact[],numerator:Measure,denominator:Measure){if(!rows.length||rows.some(r=>r.values[numerator]===null||r.values[denominator]===null))return null;const n=total(rows,numerator).value!,d=total(rows,denominator).value!;return d>0?n/d:null;}
export function group(rows:Fact[],axis:Axis){const groups=new Map<string,Fact[]>();for(const row of rows){const k=row[axis]||'未分類';groups.set(k,[...(groups.get(k)??[]),row]);}return [...groups].sort(([a],[b])=>a.localeCompare(b,'ja'));}
export function previousPeriod(start:string,end:string){const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;return{start:new Date(Date.parse(start)-days*86400000).toISOString().slice(0,10),end:new Date(Date.parse(start)-86400000).toISOString().slice(0,10)};}
export function delta(now:ReturnType<typeof total>,before:ReturnType<typeof total>){return now.value!==null&&before.value!==null&&!now.missing&&!before.missing?now.value-before.value:null;}
