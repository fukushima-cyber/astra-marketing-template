import test from 'node:test';
import assert from 'node:assert/strict';
import {dailySegments, partialMetric} from '../lib/company.ts';
import type {CompanyDay} from '../lib/company.ts';

const day=(date:string,revenue:number|null,count=1):CompanyDay=>({date,revenue,revenueCount:count,records:2,days:1,definitions:1,latest:date,payments:null,refunds:null,cost:null,sales:null,registrations:null,paymentsCount:0,refundsCount:0,costCount:0,salesCount:0,registrationsCount:0});
test('日別グラフは未記録日と未取得で線を切り、実測0と部分集計を残す',()=>{
 const segments=dailySegments([day('2026-09-01',100),day('2026-09-02',0,2),day('2026-09-04',50),day('2026-09-05',null,0),day('2026-09-06',25)],'revenue');
 assert.deepEqual(segments.map(s=>s.map(p=>p.value)),[[100,0],[50],[25]]);
 assert.equal(segments[0][0].partial,true);assert.equal(segments[0][1].partial,false);
 assert.equal(partialMetric(day('2026-09-05',null,0),'revenue'),false);
});
test('未取得だけの期間と単日の0を正しく扱う',()=>{
 assert.deepEqual(dailySegments([],'revenue'),[]);
 assert.deepEqual(dailySegments([day('2026-09-01',null,0)],'revenue'),[]);
 assert.deepEqual(dailySegments([day('2026-09-01',0,2)],'revenue'),[[{date:'2026-09-01',value:0,partial:false}]]);
});
