import test from 'node:test';
import assert from 'node:assert/strict';
import {chartBounds,chartSegments,countCategories,numericValue} from '../lib/chart-model.ts';
test('異なる状態を件数で集計し、空の集合からダミー件数を作らない',()=>{
 assert.deepEqual(countCategories([],String),[]);
 assert.deepEqual(countCategories(['done','pending','done'],String,{done:'完了'}).map(p=>[p.label,p.value]),[['完了',2],['pending',1]]);
});
test('売上・粗利の負値と0を軸に残し、非数と未取得を数値化しない',()=>{
 assert.deepEqual(chartBounds([{id:'a',label:'a',value:-30},{id:'b',label:'b',value:70},{id:'c',label:'c',value:NaN}]),{min:-30,max:70});
 assert.deepEqual(chartBounds([{id:'zero',label:'zero',value:0}]),{min:0,max:1});
 for(const raw of ['', ' ', 'unknown', null, Infinity])assert.equal(numericValue(raw),null);
 assert.equal(numericValue('0'),0);assert.equal(numericValue('120.5'),120.5);
});
test('日次記録の欠落と欠測の両方で線を分断する',()=>{
 const values=[['2026-09-01',20],['2026-09-02',0],['2026-09-04',50],['2026-09-05',null],['2026-09-06',30]] as const;
 const segments=chartSegments(values.map(([date,value])=>({id:date,date,label:date,value})));
 assert.deepEqual(segments.map(s=>s.map(p=>p.value)),[[20,0],[50],[30]]);
});
