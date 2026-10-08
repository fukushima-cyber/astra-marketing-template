import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeRanking,creativeImageUrl,donutParts} from '../lib/dashboard-model.ts';
import {creativePreviews} from '../cloud/meta-ads.ts';
import type {Report} from '../lib/ads/model.ts';
const row=(id:string,spend:number|null,n:number):Report=>({date:'2026-10-01',adId:id,adName:id,campaignId:'1',adsetId:'2',spend,impressions:100,clicks:20,actions:{lead:n},actionValues:{}});
test('CR ranking uses the chosen result, excludes small samples and incomplete costs, and divides totals',()=>{
 const rows=[row('a',100,3),{...row('a',100,3),date:'2026-10-02'},row('b',300,10),row('tiny',1,1),row('missing',null,20),row('free',0,20)];
 assert.deepEqual(creativeRanking([],rows,'lead').map(r=>r.id),['b','a']);
 assert.equal(creativeRanking([],rows,'lead')[1].cpa,200/6);
 assert.deepEqual(creativeRanking([],rows,''),[]);assert.deepEqual(creativeRanking([],rows,'purchase'),[]);
});
test('composition refuses partial, negative or missing values, keeps zero distinct',()=>{
 assert.equal(donutParts([{id:'a',label:'a',value:4,partial:true}]).missing,true);
 assert.equal(donutParts([{id:'a',label:'a',value:null}]).missing,true);
 assert.equal(donutParts([{id:'a',label:'a',value:-1}]).invalid,true);
 const d=donutParts([{id:'a',label:'a',value:0}]);assert.equal(d.total,0);assert.equal(d.missing,false);
});
test('preview URLs only permit HTTPS Meta CDNs without embedded credentials',()=>{
 assert.equal(creativeImageUrl('https://scontent.xx.fbcdn.net/img?a=1'),'https://scontent.xx.fbcdn.net/img?a=1');
 for(const url of ['http://scontent.xx.fbcdn.net/img','https://fbcdn.net.evil.test/x','javascript:alert(1)','https://a:b@scontent.xx.fbcdn.net/x','https://example.test/image','https://scontent.xx.fbcdn.net/x?access_token=secret'])assert.equal(creativeImageUrl(url),undefined);
});
test('Meta previews are read only, paginated and mapped by ad ID',async()=>{
 const old=globalThis.fetch;let requests=0;
 globalThis.fetch=async(input,options)=>{const u=new URL(String(input));assert.equal(options?.method,'GET');assert.ok(u.searchParams.get('fields')?.includes('creative{'));requests++;return Response.json({data:[{id:requests===1?'101':'102',creative:{id:'201',name:'素材',thumbnail_url:'https://scontent.xx.fbcdn.net/x',image_url:'javascript:bad',video_id:'301'}}],...(requests===1?{paging:{next:'ignored',cursors:{after:'page2'}}}:{})});};
 try{const previews=await creativePreviews('test-token','act_123');assert.equal(previews.size,2);assert.equal(previews.get('101')?.imageUrl,undefined);assert.equal(previews.get('102')?.videoId,'301');}finally{globalThis.fetch=old;}
});
