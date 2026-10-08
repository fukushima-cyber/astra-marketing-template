import {total,measures,type Fact,type Measure} from './analytics/model.ts';
import type {Sale} from './commerce.ts';
export function factDetail(rows:Fact[],key:Measure){const sum=total(rows,key);return {sum,columns:['日付','媒体','ファネル',measures[key],'出典','定義','元データID','取得日'],rows:rows.map(r=>[r.date,r.platform,r.funnel.name,r.values[key],r.source,r.definition,r.externalId,r.collectedAt])};}
export type CommerceDetailKey='gross'|'refunds'|'fees'|'net'|'pending';
export function commerceDetailRows(entries:Sale[],key:CommerceDetailKey,start:string,end:string,productId=''){
 return entries.filter(e=>!e.voidReason&&e.date>=start&&e.date<=end&&(!productId||e.productId===productId)&& (key==='gross'?e.kind==='sale':key==='refunds'?e.kind==='refund':key==='pending'?e.kind==='sale'&&e.payment==='pending':true));
}
