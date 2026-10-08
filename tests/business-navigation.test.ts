import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedBusinessId,businessSwitchUrl,type BusinessSummary} from '../lib/business.ts';
import {validFunnelRegistry} from '../lib/marketing-business/funnels.ts';
import {validateFact} from '../lib/analytics/model.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
test('旧カテゴリURLでも事業を制限せず、切替で他事業の絞り込みを引き継がない',()=>{
 const rows:BusinessSummary[]=[{id:'one',name:'事業A',kind:'affiliate',archivedAt:null},{id:'two',name:'事業B',kind:'content',archivedAt:'2026-01-01'}];
 assert.equal(selectedBusinessId(rows,new URL('https://example.test/marketing?kind=content&businessId=one')),'one');
 assert.equal(selectedBusinessId(rows,new URL('https://example.test/marketing?businessId=two')),'');
 const url=businessSwitchUrl(new URL('https://example.test/marketing?kind=content&projectId=p&funnelId=f&campaign=c&handoff=h&start=2026-09-01&end=2026-09-30'),'one');
 assert.deepEqual([...url.searchParams.keys()],['businessId','panel','start','end']);assert.equal(url.searchParams.get('businessId'),'one');
});
test('SEOからアフィリエイトへのファネルと実績を保存形式として受理する',()=>{
 const project={id:'p',name:'商品',product:'紹介商品',objective:''};
 const funnel={id:'f',projectId:'p',name:'SEOから成約',source:'seo' as const,revenueModel:'affiliate' as const,medium:'検索',status:'draft' as const,goalIds:[],notes:'',stages:[{id:'s1',name:'記事',action:'',metric:'訪問数',url:''},{id:'s2',name:'成約',action:'',metric:'成約数',url:''}]};
 assert.equal(validFunnelRegistry([project],[funnel],[]),true);
 assert.equal(validFunnelRegistry([project],[{...funnel,revenueModel:'invalid' as any}],[]),false);
 const input={source:'CSV',externalId:'one',date:'2026-09-01',collectedAt:'2026-09-02',projectId:'p',funnelId:'f',sourceType:'seo',platform:'Google検索',content:'記事',angle:'',format:'',definition:'日次の確定成約',values:{cost:null,revenue:100,payments:null,refunds:null,registrations:null,sales:1},stageCounts:{}};
 assert.equal(validateFact(input,{...emptyBusiness,projects:[project],funnels:[funnel]}).sourceType,'seo');
});
