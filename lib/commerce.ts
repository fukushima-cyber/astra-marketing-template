import {validDate} from './analytics/model.ts';
import {revenueModelNames,type RevenueModel} from './business.ts';
export type Product={id:string;name:string;model:RevenueModel;price:number;archived:boolean;updatedAt:string};
export type Sale={id:string;productId:string;productName:string;model:RevenueModel;date:string;quantity:number;amount:number;fee:number;payment:'paid'|'pending';kind:'sale'|'refund';originalId:string;reference:string;notes:string;createdAt:string;updatedAt:string;voidReason:string};
export type Commerce={products:Product[];entries:Sale[]};
export const emptyCommerce:Commerce={products:[],entries:[]};
const key=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const money=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=100000000000;
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
export function productInput(v:any):Omit<Product,'updatedAt'>{
 if(!v||!key(v.id)||!str(v.name,100)||!v.name.trim()||!Object.hasOwn(revenueModelNames,v.model)||!money(v.price)||typeof v.archived!=='boolean')throw new Error('商品名、販売方法、価格を確認してください。');
 return {id:v.id,name:v.name.trim(),model:v.model,price:v.price,archived:v.archived};
}
export function saleInput(v:any,data:Commerce):Omit<Sale,'createdAt'|'updatedAt'|'voidReason'>{
 if(!v||!key(v.id)||!key(v.productId)||!validDate(v.date)||!Number.isSafeInteger(v.quantity)||v.quantity<1||v.quantity>100000||!money(v.amount)||!money(v.fee)||v.fee>v.amount||!['paid','pending'].includes(v.payment)||!['sale','refund'].includes(v.kind)||!str(v.originalId,100)||!str(v.reference,150)||!str(v.notes,1000))throw new Error('日付、数量、金額、入金状態を確認してください。金額は税込の整数円で入力してください。');
 const p=data.products.find(p=>p.id===v.productId);if(!p||(p.archived&&v.kind!=='refund'))throw new Error('販売中の商品を選んでください。');
 if(v.reference.trim()&&data.entries.some(e=>e.kind===v.kind&&e.reference===v.reference.trim()&&!e.voidReason))throw new Error('同じ注文番号の記録があります。二重登録を確認してください。');
 if(v.kind==='refund'){
  const original=data.entries.find(e=>e.id===v.originalId&&e.kind==='sale'&&!e.voidReason&&e.productId===v.productId);
  if(!original||v.date<original.date)throw new Error('返金元の売上と返金日を確認してください。');
  const returned=data.entries.filter(e=>e.kind==='refund'&&e.originalId===original.id&&!e.voidReason).reduce((n,e)=>n+e.amount,0);
  if(v.amount<=0||returned+v.amount>original.amount)throw new Error('返金額が元の売上の残額を超えています。');
 }else if(v.originalId)throw new Error('売上には返金元を指定できません。');
 return {id:v.id,productId:p.id,productName:p.name,model:p.model,date:v.date,quantity:v.quantity,amount:v.amount,fee:v.fee,payment:v.payment,kind:v.kind,originalId:v.originalId,reference:v.reference.trim(),notes:v.notes};
}
export function commerceTotals(entries:Sale[],start:string,end:string){
 const rows=entries.filter(e=>!e.voidReason&&e.date>=start&&e.date<=end);
 const sales=rows.filter(e=>e.kind==='sale'),refunds=rows.filter(e=>e.kind==='refund');
 const add=(xs:Sale[],k:'amount'|'fee')=>xs.reduce((n,e)=>n+e[k],0);
 const gross=add(sales,'amount'),returned=add(refunds,'amount'),fees=add(rows,'fee');
 return {records:rows.length,gross,refunds:returned,fees,net:gross-returned-fees,paid:add(sales.filter(e=>e.payment==='paid'),'amount')-add(refunds.filter(e=>e.payment==='paid'),'amount'),pending:add(sales.filter(e=>e.payment==='pending'),'amount'),quantity:sales.reduce((n,e)=>n+e.quantity,0)};
}
