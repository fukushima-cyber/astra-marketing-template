import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePages,sum,followersIn} from '../lib/connected/model.ts';
import {connected} from '../cloud/connected.ts';
import type {Env} from '../cloud/types.ts';
const raw={data:[{step_name:'比較ページ',pages:[{page_id:'a',page_name:'入口A',has_payment_element:false,totals:{pv:20,uu:8,registration_count:2},daily:[{date:'2026-09-01',pv:10,uu:6,registration_count:1},{date:'2026-09-02',pv:10,uu:6,registration_count:1}]},{page_id:'b',page_name:'入口B',has_payment_element:true,totals:{pv:0,uu:0,sale_amount:0},daily:[]}]}]};
test('ページ別集計を保持し、期間UUを日別UUの和に置き換えない',()=>{
 const pages=normalizePages(raw,'f','2026-09-01','2026-09-02');assert.equal(pages.length,2);assert.equal(pages[0].totals.uu,8);assert.equal(pages[0].totals.revenue,null);assert.equal(pages[1].totals.revenue,0);assert.equal(pages[0].daily.length,2);assert.notEqual(pages[0].id,pages[1].id);assert.deepEqual(sum([0,null]),{value:0,missing:1});
});
test('取得のない期間はフォロワー0や期間外の値で埋めない',()=>{
 const a={id:'a',platform:'threads',handle:'a',displayName:null,status:'active',series:[{date:'2026-08-01',followers:20,impressions:null},{date:'2026-09-01',followers:30,impressions:null}]};
 assert.equal(followersIn(a,'2026-09-02','2026-09-07').value,null);assert.equal(followersIn(a,'2026-09-01','2026-09-07').change,null);
});
