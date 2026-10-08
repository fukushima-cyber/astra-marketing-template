import {can,permission,type Identity} from '../lib/access.ts';
import {emptyCommerce,productInput,saleInput,commerceTotals,type Commerce} from '../lib/commerce.ts';
import {validDate} from '../lib/analytics/model.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,digest,Conflict} from './storage.ts';
import {audit} from './identity.ts';
import type {Env} from './types.ts';
const json=(v:unknown,status=200)=>Response.json(v,{status});
export async function commerce(r:Request,env:Env,user:Identity,scope:string){
 // A project-limited grant must never expose the entire business ledger.
 const grant=permission(user,scope,'business');
 if(!can(user,scope,'business',r.method!=='GET')||grant?.projects!==null)return json({error:'商品と売上は事業全体の案件設定権限が必要です。'},403);
 const id=documentId(scope,'commerce'),doc=await readDocument<Commerce>(env.DB,id,emptyCommerce);
 const output=()=>({version:doc.version,data:doc.data,currency:'JPY'});
 try{
 if(r.method==='GET'){
  const q=new URL(r.url).searchParams,start=q.get('start'),end=q.get('end');
  if(q.has('limit')){
   if(!validDate(start)||!validDate(end)||start>end||q.get('limit')!=='100'||!/^\d{1,6}$/.test(q.get('cursor')??'0'))return json({error:'集計期間とページを確認してください。'},400);
   const cursor=Number(q.get('cursor')??0),entries=doc.data.entries.filter(e=>e.date>=start&&e.date<=end);
   return json({version:doc.version,currency:'JPY',data:{products:doc.data.products,entries:entries.slice(cursor,cursor+100)},nextCursor:cursor+100<entries.length?String(cursor+100):null,totals:commerceTotals(doc.data.entries,start,end)});
  }
  if(start||end){if(!validDate(start)||!validDate(end)||start>end)return json({error:'集計期間を確認してください。'},400);return json({...output(),totals:commerceTotals(doc.data.entries,start,end)});}
  return json(output());
 }
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 const raw=await r.text();if(raw.length>10000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw);
 if(!b||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId))throw new Error('保存の版と操作識別子を確認してください。');
 const signature=await digest(raw),receipt=await env.DB.prepare('SELECT signature FROM receipts WHERE id=?').bind(id+':'+b.requestId).first<{signature:string}>();
 if(receipt){if(receipt.signature!==signature)throw new Conflict('操作識別子が競合しています。');return json(output());}
 if(doc.version!==b.expectedVersion)throw new Conflict('別の画面で更新されています。再取得して確認してください。');
 const data:Commerce={products:[...doc.data.products],entries:[...doc.data.entries]},now=new Date().toISOString();
 if(b.action==='save_product'){
  const p=productInput(b.product),old=data.products.find(p2=>p2.id===p.id);if(!old&&data.products.length>=200)throw new Error('商品は200件まで登録できます。');
  const next={...p,updatedAt:now};data.products=old?data.products.map(p2=>p2.id===p.id?next:p2):[...data.products,next];
 }else if(b.action==='record_sale'){
  if(data.entries.length>=5000)throw new Error('この事業の記帳は5000件までです。');
  if(data.entries.some(e=>e.id===b.entry?.id))throw new Error('同じ記録IDが存在します。');
  data.entries.push({...saleInput(b.entry,data),createdAt:now,updatedAt:now,voidReason:''});
 }else if(b.action==='mark_payment'){
  const entry=data.entries.find(e=>e.id===b.id);if(!entry||entry.voidReason||!['paid','pending'].includes(b.payment))throw new Error('記録と入金状態を確認してください。');
  data.entries=data.entries.map(e=>e.id===entry.id?{...e,payment:b.payment,updatedAt:now}:e);
 }else if(b.action==='void_entry'){
  const entry=data.entries.find(e=>e.id===b.id);if(!entry||entry.voidReason||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)throw new Error('記録と取消理由を確認してください。');
  if(data.entries.some(e=>e.originalId===entry.id&&!e.voidReason))throw new Error('先に関連する返金記録を取り消してください。');
  data.entries=data.entries.map(e=>e.id===entry.id?{...e,voidReason:b.reason.trim(),updatedAt:now}:e);
 }else throw new Error('操作を確認してください。');
 await commitDocument(env.DB,id,doc.version,data,b.requestId,signature);
 await audit(env,user.id,'commerce.updated',id,{action:b.action,version:doc.version+1,requestId:b.requestId});
 return json({version:doc.version+1,data,currency:'JPY'});
 }catch(e){return json({error:e instanceof Error?e.message:'保存できませんでした。'},e instanceof Conflict?409:400);}
}
