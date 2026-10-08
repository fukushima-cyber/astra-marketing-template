import test from 'node:test';
import assert from 'node:assert/strict';
import {reason} from '../cloud/improvement-model.ts';
import type {Env} from '../cloud/types.ts';
test('モデルは資料の目録から任意に本文を取得し、参照と利用量を残す',async()=>{const original=globalThis.fetch;const inputs:any[]=[];globalThis.fetch=async(_url,init)=>{inputs.push(JSON.parse(String(init?.body)));return Response.json({status:'completed',usage:{total_tokens:10},output:inputs.length===1?[{type:'function_call',name:'read_knowledge',arguments:'{"id":"k"}',call_id:'call1'}]:[{type:'message',content:[{type:'output_text',text:'根拠を確認して改善する'}]}]});};try{const r=await reason({ASTRA_OPENAI_KEY:'test',ASTRA_MODEL:'test'} as Env,'目的',{sales:2},[{id:'k',title:'資料',source:'出典',content:'本文は必要時だけ渡す',updatedAt:'2026-09-10'}]);assert.equal(inputs[0].store,false);assert.ok(!JSON.stringify(inputs[0].input).includes('本文は必要時だけ渡す'));assert.ok(JSON.stringify(inputs[1].input).includes('本文は必要時だけ渡す'));assert.deepEqual(r.references,['k']);assert.equal(r.tokens,20);}finally{globalThis.fetch=original;}});

test('事業に保存したモデルと暗号化キーを診断にも使用する',async()=>{
 const {seal}=await import('../cloud/native.ts');const original=globalThis.fetch;let auth='',model='';
 const env={CONNECTOR_KEY:btoa('01234567890123456789012345678901'),ASTRA_OPENAI_KEY:'fallback-key',ASTRA_MODEL:'fallback-model'} as Env;
 const credential=await seal(env,'selected','autonomy-model','business-key');
 env.DB={prepare:()=>({bind(scope:string){assert.equal(scope,'selected');return this;},async first(){return {business_id:'selected',model:'business-model',credential};}})} as unknown as Env['DB'];
 globalThis.fetch=async(_url,init)=>{auth=new Headers(init?.headers).get('Authorization')??'';model=JSON.parse(String(init?.body)).model;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'検証結果'}]}]});};
 try{const result=await reason(env,'診断',{},[],'selected');assert.equal(auth,'Bearer business-key');assert.equal(model,'business-model');assert.equal(result.model,'business-model');}
 finally{globalThis.fetch=original;}
});
