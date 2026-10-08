'use client';
import './measurement.css';
import {DetailValue,DataDetailDrawer,type DataDetail} from './data-detail';
import {useEffect,useRef,useState} from 'react';
import {useBusinessFetch} from './business-context';
import {goalPace,goalRange} from '@/lib/marketing-business/goal-pace';
import {metricUnit,type BusinessGoal} from '@/lib/marketing-business/types';
import type {MetricResult} from '@/lib/measurement/model';
const fmt=(v:number|null)=>v===null?'未算出':v.toLocaleString('ja-JP',{maximumFractionDigits:1});
export default function GoalPacePanel({goals,refresh=0,onSettings}:{goals:BusinessGoal[];refresh?:number;onSettings?:()=>void}){
 const [detail,setDetail]=useState<DataDetail|null>(null),detailRequest=useRef(0);
 const fetch=useBusinessFetch(),[results,setResults]=useState<Record<string,ReturnType<typeof goalPace>>>({}),[busy,setBusy]=useState(false);
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}),signature=JSON.stringify(goals);
 useEffect(()=>{detailRequest.current++;setDetail(null);const c=new AbortController();setResults({});setBusy(false);const targets=goals.filter(g=>g.period);if(!targets.length)return;setBusy(true);
 const requests=new Map<string,Promise<{metrics:Record<string,MetricResult>;policy:{version:number}|null}>>();
 void Promise.all(targets.map(async g=>{const range=goalRange(g,today);if(!range)return[g.id,goalPace(g,undefined,null,today)] as const;
 const query=new URLSearchParams(range).toString();if(!requests.has(query))requests.set(query,(async()=>{const r=await fetch('/api/marketing/measurement?'+query,{signal:c.signal,cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error);return b;})());
 try{const b=await requests.get(query)!;return[g.id,goalPace(g,b.metrics[g.metric==='revenue'?'revenue':'sales'],b.policy?.version??null,today)] as const;}catch{return[g.id,goalPace(g,undefined,g.period!.policyVersion,today)] as const;}
 })).then(rows=>{if(!c.signal.aborted){setResults(Object.fromEntries(rows));setBusy(false);}});return()=>{c.abort();detailRequest.current++;};},[fetch,signature,refresh,today]);
 async function show(g:BusinessGoal){const id=++detailRequest.current,range=goalRange(g,today);setDetail({title:g.title,columns:[],rows:[],loading:true});
 try{const key=g.metric==='revenue'?'revenue':'sales';let metric:MetricResult|undefined,version:number|null=null;
 if(range&&g.period){const r=await fetch('/api/marketing/measurement?'+new URLSearchParams({...range,detail:key}),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error);metric=b.metrics[key];version=b.policy?.version??null;}
 if(id!==detailRequest.current)return;const pace=goalPace(g,metric,version,today),elapsed=range?(Date.parse(range.end)-Date.parse(range.start))/86400000+1:0;
 setDetail({title:g.title,context:[g.period?'目標期間 '+g.period.start+'〜'+g.deadline:'観測を比較する目標',range?'集計期間 '+range.start+'〜'+range.end:'集計できる期間なし',metric?.source??'取得元なし'],columns:['項目','値'],rows:[['目標',g.target],['現在',pace.current],['残り',pace.remaining],['残り日数',pace.days],['必要ペース / 日',pace.perDay],['経過日数',elapsed],['期限時点の参考値',pace.projection],...(metric?.points??[]).map(p=>[p.date,p.value] as [string,number|null])],note:pace.reason+' 残り = 最大(0, 目標 − 現在)。必要ペース = 残り ÷ 残り日数。参考値 = 現在 ÷ 経過日数 × 目標期間の日数（7日以上の観測時のみ）。日別の未取得は0にしません。'});
 }catch(e){if(id===detailRequest.current)setDetail({title:g.title,columns:[],rows:[],error:e instanceof Error?e.message:'取得できませんでした。'});}}
 return <section aria-label="目標の必要ペース"><div className="mp-toolbar"><h3>期限までに必要なペース</h3>{onSettings&&<button onClick={onSettings}>目標を確認・設定</button>}</div>{goals.length>0&&<details><summary>集計について</summary><p>各目標の開始日から昨日まで（日本時間）。上の期間選択とは別に集計します。</p></details>}{busy&&<p role="status">目標期間の記録を確認中…</p>}<div className="measurement-cards">{goals.map(g=>{const p=results[g.id]??(!g.period?goalPace(g,undefined,null,today):null),range=goalRange(g,today);return <article key={g.id}><h4>{g.title}</h4><p>目標 <DetailValue label={g.title+'の目標'} onClick={()=>void show(g)}>{fmt(g.target)}</DetailValue>{metricUnit(g.metric)} / 期限 {g.deadline} / 担当 {g.owner}</p>{p?<><strong><DetailValue label={g.title+'の実績'} onClick={()=>void show(g)}>{p.current===null?'未算出':fmt(p.current)+metricUnit(g.metric)}</DetailValue></strong><p>{p.reason}</p>{p.projection!==null&&<p>現在の平均ペースが続いた場合の期限時点：<DetailValue label={g.title+'の計算元'} onClick={()=>void show(g)}>{fmt(p.projection)}</DetailValue>{metricUnit(g.metric)}。季節性や施策変更を含まない参考値です。</p>}{p.remaining!==null&&<><p>残り <DetailValue label={g.title+'の計算元'} onClick={()=>void show(g)}>{fmt(p.remaining)}</DetailValue>{metricUnit(g.metric)} / {p.days}日</p><p>必要ペース <DetailValue label={g.title+'の計算元'} onClick={()=>void show(g)}>{fmt(p.perDay)}</DetailValue>{p.perDay===null?'':metricUnit(g.metric)+'/日'}</p></>}</>:<p>確認中…</p>}{g.period&&<small>目標期間 {g.period.start}〜{g.deadline} / 集計済み期間 {range?range.start+'〜'+range.end:'なし'}</small>}</article>;})}</div>{!goals.length&&<p>目標がありません</p>}<DataDetailDrawer data={detail} onClose={()=>{detailRequest.current++;setDetail(null);}}/></section>;
}
