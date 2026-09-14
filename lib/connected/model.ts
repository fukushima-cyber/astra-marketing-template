import {validDate} from '../analytics/model.ts';
export type Day={date:string;pv:number|null;uu:number|null;registrations:number|null;sales:number|null;revenue:number|null};
export type Page={id:string;funnelId:string;step:string;name:string;payment:boolean;totals:Omit<Day,'date'>;daily:Day[]};
export type Account={id:string;platform:string;handle:string;displayName:string|null;status:string;series:{date:string;followers:number|null;impressions:number|null}[]};
export type SourceGroup={id:string;displayName:string;funnelIds:string[];status:string;series:{date:string;pv:number|null;uu:number|null;registrationCount:number|null}[]};
export type Catalog={accounts:Account[];groups:SourceGroup[];globalEnabled:boolean;fetchedAt:string;errors:string[]};
export type Links={version:number;groups:Record<string,string[]>};
export type ConnectedResult={pages:Page[];failures:{funnelId:string;message:string}[];collectedAt:string};
export const n=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const str=(v:unknown)=>typeof v==='string'?v.slice(0,1000):'';
export function normalizePages(raw:unknown,funnelId:string,start:string,end:string):Page[]{
 const data=obj(raw).data;if(!Array.isArray(data))throw new Error('UTAGEの応答形式を確認してください。');
 const totals=(v:unknown)=>{const r=obj(v);return{pv:n(r.pv),uu:n(r.uu),registrations:n(r.registration_count),sales:n(r.sale_count),revenue:n(r.sale_amount)};};
 return data.flatMap(step=>{const s=obj(step);if(!Array.isArray(s.pages))throw new Error('ページ情報を取得できませんでした。');return s.pages.map(page=>{const p=obj(page);if(typeof p.page_id!=='string'||!Array.isArray(p.daily))throw new Error('ページ情報を取得できませんでした。');return{id:funnelId+':'+p.page_id,funnelId,step:str(s.step_name),name:str(p.page_name),payment:p.has_payment_element===true,totals:totals(p.totals),daily:p.daily.map(v=>({...totals(v),date:str(obj(v).date)})).filter(d=>validDate(d.date)&&d.date>=start&&d.date<=end).sort((a,b)=>a.date.localeCompare(b.date))};});});
}
export function sum(values:(number|null)[]){const known=values.filter((n):n is number=>n!==null);return{value:known.length?known.reduce((a,b)=>a+b,0):null,missing:values.length-known.length};}
export const yen=(v:number|null)=>v===null?'未取得':v.toLocaleString('ja-JP',{maximumFractionDigits:0});
export function windowDates(days:number){const end=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);return{start:new Date(Date.parse(end)-(days-1)*86400000).toISOString().slice(0,10),end};}
export function followersIn(a:Account,start:string,end:string){const series=a.series.filter(s=>s.date>=start&&s.date<=end&&s.followers!==null).sort((a,b)=>a.date.localeCompare(b.date));const first=series[0],last=series.at(-1);return{value:last?.followers??null,change:series.length>=2?last!.followers!-first!.followers!:null,date:last?.date??null,firstDate:first?.date??null};}
