import test from 'node:test';
import assert from 'node:assert/strict';
import {factDetail,commerceDetailRows} from '../lib/data-detail.ts';
import {commerceTotals,type Sale} from '../lib/commerce.ts';
import type {Fact} from '../lib/analytics/model.ts';
test('取込実績の明細は未取得と計測済み0を区別し、元IDを保持する',()=>{
 const row=(id:string,value:number|null)=>({date:'2026-10-01',platform:'meta',source:'CSV',funnel:{name:'entry'},values:{cost:value},definition:'same',externalId:id,collectedAt:'2026-10-02'} as Fact);
 const d=factDetail([row('a',0),row('b',20),row('c',null)],'cost');
 assert.deepEqual(d.sum,{value:20,missing:1,count:3});assert.deepEqual(d.rows.map(r=>r[3]),[0,20,null]);assert.deepEqual(d.rows.map(r=>r[6]),['a','b','c']);assert.equal(factDetail([],'cost').sum.value,null);
});
test('売上の明細は期間と商品を絞り、取消を除外し、合計と一致する',()=>{
 const row={id:'sale',productId:'p',kind:'sale',date:'2026-10-01',amount:1000,fee:50,payment:'pending',voidReason:''} as Sale;
 const entries=[row,{...row,id:'paid',payment:'paid' as const,amount:2000},{...row,id:'refund',kind:'refund' as const,amount:200,fee:0},{...row,id:'void',voidReason:'訂正'},{...row,id:'outside',date:'2026-09-01'},{...row,id:'other',productId:'q'}];
 const totals=commerceTotals(entries.filter(e=>e.productId==='p'),'2026-10-01','2026-10-31');
 const rows=(key:Parameters<typeof commerceDetailRows>[1])=>commerceDetailRows(entries,key,'2026-10-01','2026-10-31','p');
 assert.equal(rows('gross').reduce((n,r)=>n+r.amount,0),totals.gross);assert.equal(rows('refunds').reduce((n,r)=>n+r.amount,0),totals.refunds);assert.equal(rows('pending').reduce((n,r)=>n+r.amount,0),totals.pending);assert.equal(rows('fees').reduce((n,r)=>n+r.fee,0),totals.fees);assert.equal(rows('net').reduce((n,r)=>n+(r.kind==='sale'?r.amount:-r.amount)-r.fee,0),totals.net);assert.deepEqual(rows('pending').map(r=>r.id),['sale']);
});
