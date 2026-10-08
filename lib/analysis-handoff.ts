import {digest} from '../cloud/storage.ts';
import {total,type Fact,type Filter} from './analytics/model.ts';
export type AnalysisSnapshot={factIds:string[];digest:string;capturedAt:string;returnPath:string;filter:Filter};
export async function snapshotAnalysis(rows:Fact[],filter:Filter,returnPath:string,at:string):Promise<AnalysisSnapshot>{if(rows.length>500)throw new Error('根拠は500記録までです。条件を絞ってください。');return{factIds:rows.map(r=>r.id).sort(),digest:await digest(JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)))),capturedAt:at,returnPath,filter};}
export type AnalysisHandoff={snapshot?:AnalysisSnapshot;id:string;businessId:string;title:string;source:string;comparison:string;returnPath:string;createdAt:string};
export const handoffKey=(businessId:string,id:string)=>`astra-analysis-handoff:${businessId}:${id}`;
const format=(value:number|null)=>value===null?'未取得':value.toLocaleString('ja-JP',{maximumFractionDigits:1});
export function analysisReturnPath(current:URL,businessId:string,filter:Filter){
 const url=new URL('/marketing',current.origin);
 url.searchParams.set('businessId',businessId);url.searchParams.set('panel','analytics');
 const kind=current.searchParams.get('kind');if(kind==='content'||kind==='affiliate')url.searchParams.set('kind',kind);
 for(const [key,value] of Object.entries(filter))if(value)url.searchParams.set(key,value);
 for(const key of ['analysisView','axis','column','metric','density','columns']){const value=current.searchParams.get(key);if(value)url.searchParams.set(key,value);}
 return url.pathname+url.search;
}
export function safeAnalysisPath(path:string,businessId:string){
 try{const url=new URL(path,'https://astra.invalid');return url.origin==='https://astra.invalid'&&url.pathname==='/marketing'&&url.searchParams.get('panel')==='analytics'&&url.searchParams.get('businessId')===businessId?url.pathname+url.search:null;}catch{return null;}
}
export function makeAnalysisHandoff(input:{id:string;businessId:string;title:string;rows:Fact[];filter:Filter;url:URL;createdAt:string}):AnalysisHandoff{
 const {rows,filter}=input;
 const value=(metric:'revenue'|'cost')=>{const sum=total(rows,metric);return `${format(sum.value)}円${sum.missing?`（${sum.missing}記録が未取得・取得済み分の小計）`:''}`;};
 const definitions=[...new Set(rows.map(r=>r.definition))];
 const source=[`分析対象：${input.title}`,`期間：${filter.start}〜${filter.end} / ${rows.length}記録`,...Object.entries(filter).filter(([k,v])=>v&&!['start','end'].includes(k)).map(([k,v])=>`${k}：${v}`),`売上：${value('revenue')} / 費用：${value('cost')}`,`出典：${[...new Set(rows.map(r=>r.source))].join('、')}`,`定義：${definitions.join(' / ')}`,`参照時点：${input.createdAt}`,`元データは更新される場合があります。欠測・重複・帰属を確認して評価してください。`].join('\n');
 return {id:input.id,businessId:input.businessId,title:input.title.slice(0,90),source:source.length>1800?source.slice(0,1740)+'\n（出典・定義の一部を省略。分析画面で全文を確認してください）':source,comparison:`対象期間 ${filter.start}〜${filter.end}。同じ出典・定義・対象・観測日数で比較できるかを確認する。`,returnPath:analysisReturnPath(input.url,input.businessId,filter),createdAt:input.createdAt};
}
export function parseHandoff(raw:string|null,businessId:string,id:string):AnalysisHandoff|null{
 if(!raw)return null;
 try{const v=JSON.parse(raw);if(v.businessId!==businessId||v.id!==id||!['title','source','comparison','returnPath','createdAt'].every(k=>typeof v[k]==='string')||v.source.length>2000||v.title.length>100||v.comparison.length>2000||!safeAnalysisPath(v.returnPath,businessId))return null;return v;}catch{return null;}
}
