import test from 'node:test';
import assert from 'node:assert/strict';
import {consultationStages,stagesFromNames,linearStageOrder,validFunnelRegistry,connectionsFor,type ProjectFunnel} from '../lib/marketing-business/funnels.ts';
import {validateFact} from '../lib/analytics/model.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
const project={id:'p',name:'面談販売',product:'講座',objective:'成約'};
function funnel(names=consultationStages){let n=0;return{id:'f',projectId:'p',name:'面談の導線',source:'other',medium:'LINE',status:'draft',goalIds:[],notes:'',stages:stagesFromNames(names,()=>String(++n))} as ProjectFunnel;}
test('7段階と30段階を独立したIDで登録・保存でき、上限超過を拒否する',()=>{for(const names of [consultationStages,Array.from({length:30},(_,i)=>'面談'+i)]){const f=funnel(names);assert.ok(validFunnelRegistry([project],[f],[]));assert.deepEqual(linearStageOrder(f)?.map(s=>s.name),names);assert.equal(connectionsFor(f).length,names.length-1);}assert.throws(()=>funnel(Array(31).fill('面談')));});
test('図の配列順が異なっても接続順で表示し、分岐や循環を一本道と誤表示しない',()=>{const f=funnel(),edges=connectionsFor(f),reordered={...f,stages:[...f.stages].reverse(),connections:edges};assert.deepEqual(linearStageOrder(reordered)?.map(s=>s.name),consultationStages);assert.equal(linearStageOrder({...f,connections:[...edges,{id:'extra',from:'1',to:'7'}]}),null);assert.equal(linearStageOrder({...f,connections:edges.map(e=>e.to==='7'?{...e,to:'1'}:e)}),null);});
test('予約・着座・2回目・3回目の数字を混ぜず、未取得を保持する',()=>{const f=funnel(),stageCounts={'1':100,'2':50,'3':40,'4':30,'5':20,'6':null,'7':5};const result=validateFact({source:'手動検証',externalId:'1',date:'2026-09-10',collectedAt:'2026-09-10',projectId:'p',funnelId:'f',sourceType:'other',platform:'LINE',content:'',angle:'',format:'',definition:'各段階の発生件数',values:{cost:null,revenue:null,payments:null,refunds:null,registrations:100,sales:5},stageCounts},{...emptyBusiness,projects:[project],funnels:[f]});assert.deepEqual(result.stageCounts,stageCounts);});
