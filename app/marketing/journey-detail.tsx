 'use client';
import {useEffect,useRef,useState} from 'react';
import {useBusinessFetch} from './business-context';
import {DataDetailDrawer,type DataDetail} from './data-detail';
export function useJourneyDetail(start:string,end:string,revision:unknown){
 const fetch=useBusinessFetch(),[detail,setDetail]=useState<DataDetail|null>(null),request=useRef(0);
 useEffect(()=>{request.current++;setDetail(null);return()=>{request.current++;};},[fetch,start,end,revision]);
 async function open(key:string,title:string,value:string,sourceId=''){
 const id=++request.current;setDetail({title,value,context:[start+'〜'+end],columns:[],rows:[],loading:true});
 try{const r=await fetch('/api/marketing/journey?'+new URLSearchParams({start,end,detail:key,...(sourceId?{sourceId}:{})}),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error);if(id!==request.current)return;const summary=sourceId?b.stages.find((s:{sourceId:string})=>s.sourceId===sourceId)?.summary:b.summary;const latest=summary?['revenue','payments','refunds'].includes(key)?summary[key]+'円':key==='cohort'?summary.cohortSize+'人':key==='cohort_qualified'?summary.cohortCounts.qualified+'人':key==='cohort_sale'?summary.cohortCounts.sale+'人':key==='unmatched'?summary.unmatched+'件':key.startsWith('events_')?summary.counts[key.slice(7)]+'件':key==='visit'||key==='ad_cost'?summary.counts[key]+'件':summary.people[key]+'人':'記録なし';setDetail({title,value:latest,context:[start+'〜'+end,...(latest!==value?['最新の記録で再集計しています。']:[])],columns:b.detail.columns,rows:b.detail.rows,note:key.startsWith('cohort')?'期間内に初回登録した顧客の、その後の成果を含みます。人数は案件内で重複を除いています。':['revenue','payments','refunds'].includes(key)?'認証済みの有効な記録だけを合計します。訂正された元の記録は除きます。':key.startsWith('events_')?'訂正された元の記録を除いた有効な全記録です。人数とは異なり同じ顧客の複数記録を含みます。':'同じ集計条件の記録です。人数は案件と顧客IDで重複を除き、代表の記録を1件表示します。閲覧は補助計測の件数です。'});}
 catch(e){if(id===request.current)setDetail({title,columns:[],rows:[],error:e instanceof Error?e.message:'取得できませんでした。'});}
 }
 async function openCampaign(connectionId:string,campaignId:string,title:string){const id=++request.current;setDetail({title,columns:[],rows:[],loading:true});
 try{const r=await fetch('/api/marketing/journey?'+new URLSearchParams({start,end,detailCampaign:JSON.stringify([connectionId,campaignId])}),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error);if(id!==request.current)return;const a=b.attribution.find((a:{connectionId:string;campaignId:string})=>a.connectionId===connectionId&&a.campaignId===campaignId);if(!a?.detail)throw new Error('キャンペーンの明細がありません。');setDetail({title,context:[start+'〜'+end,'登録 '+a.registrations+'人 / 有効申込 '+a.qualified+'人 / 成約 '+a.sales+'人','広告費 '+(a.spend===null?'未算出':a.spend+'円')+' / 成約あたり '+(a.saleCost===null?'未算出':a.saleCost+'円')],columns:a.detail.columns,rows:a.detail.rows,note:a.detail.note+' 成約あたり費用 = 広告費 ÷ 成約者。'});}catch(e){if(id===request.current)setDetail({title,columns:[],rows:[],error:e instanceof Error?e.message:'取得できませんでした。'});}}
 return {open,openCampaign,drawer:<DataDetailDrawer data={detail} onClose={()=>{request.current++;setDetail(null);}}/>};
}
