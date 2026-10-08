import test from 'node:test';
import assert from 'node:assert/strict';
import {saleInput,productInput,commerceTotals,type Commerce,type Sale} from '../lib/commerce.ts';
const product={id:'p1',name:'教材',model:'content' as const,price:1000,archived:false,updatedAt:''};
const entry={id:'s1',productId:'p1',date:'2026-10-01',quantity:1,amount:1000,fee:50,payment:'pending' as const,kind:'sale' as const,originalId:'',reference:'order-1',notes:''};
const data:Commerce={products:[product],entries:[]};
test('金額、日付、数量、他事業の商品、不正な販売方法を拒否する',()=>{
 assert.equal(saleInput(entry,data).amount,1000);
 for(const patch of [{amount:NaN},{amount:1.5},{amount:-1},{fee:1001},{quantity:0},{date:'2026-02-30'},{productId:'other'}])assert.throws(()=>saleInput({...entry,...patch},data));
 assert.throws(()=>productInput({...product,model:'invalid'}));
});
test('期間別集計は未入金も売上に含め、返金と手数料を分け、取消を除外する',()=>{
 const row={...saleInput(entry,data),createdAt:'',updatedAt:'',voidReason:''} as Sale;
 const refund={...row,id:'r1',date:'2026-10-02',kind:'refund' as const,originalId:'s1',amount:200,fee:0,payment:'paid' as const};
 const totals=commerceTotals([row,refund,{...row,id:'void',voidReason:'訂正'},{...row,id:'outside',date:'2026-09-01'}],'2026-10-01','2026-10-31');
 assert.deepEqual(totals,{records:2,gross:1000,refunds:200,fees:50,net:750,paid:-200,pending:1000,quantity:1});
 assert.equal(commerceTotals([],'2026-10-01','2026-10-31').records,0);
});
test('商品の販売終了後でも返金でき、重複注文と返金超過を防ぐ',()=>{
 const row={...saleInput(entry,data),createdAt:'',updatedAt:'',voidReason:''} as Sale;
 const archived={products:[{...product,archived:true}],entries:[row]};
 assert.throws(()=>saleInput({...entry,id:'s2'},archived));
 const refund={...entry,id:'r1',kind:'refund',originalId:'s1',amount:500,fee:0,reference:''};assert.equal(saleInput(refund,archived).amount,500);
 assert.throws(()=>saleInput({...refund,amount:1001},archived));
 assert.throws(()=>saleInput({...entry,id:'s2'}, {...data,entries:[row]}));
});
