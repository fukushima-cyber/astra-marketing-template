'use client';
import CompanyCharts from '../company/charts';
import {DetailValue,useDataDetail} from './data-detail';
import {companyMetrics,type CompanyBusiness,type CompanyMetric} from '@/lib/company';
import {useEffect,useState} from 'react';
import {useBusiness} from './business-context';
import RangePicker from './date-range';
import {initialRange,rememberRange} from '@/lib/date-range';
import type {CompanySummary} from '@/lib/company';

const number=(value:number|null|undefined)=>value==null?'未取得':value.toLocaleString('ja-JP');

export default function CategoryDashboard(){
 const detail=useDataDetail();const scope=useBusiness(),itemName='事業',kindName='全事業';
 const [range,setRange]=useState(initialRange),[data,setData]=useState<CompanySummary|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);detail.show(null);setError('');fetch('/api/company?'+new URLSearchParams({...range}),{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);return body;}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[range.start,range.end,retry]);
 const rows=data?.businesses??[],withRecords=rows.filter(b=>(b.metrics?.records??0)>0).length,latest=rows.map(b=>b.metrics?.latest).filter((value):value is string=>!!value).sort().at(-1);
 function showBusinesses(title:string,selected:CompanyBusiness[]){detail.show({title,context:[range.start+'〜'+range.end],columns:['事業','実績記録','日数','最新日'],rows:selected.map(b=>[b.name,b.metrics?.records??null,b.metrics?.days??null,b.metrics?.latest??'なし'])});}
 function showMetric(b:CompanyBusiness,key:CompanyMetric){if(!b.metrics)return;detail.show({title:b.name+' / '+companyMetrics[key].label,value:number(b.metrics[key]),context:[range.start+'〜'+range.end,b.restrictedProjects?'許可された案件のみ':'取込実績'],columns:['日付',companyMetrics[key].label,'値のある記録','全記録'],rows:(b.daily??[]).map(d=>[d.date,d[key],d[`${key}Count`],d.records]),note:'同じ条件の日別集計です。未取得を0にしません。'});}
 return <section className="category-dashboard"><RangePicker value={range} onChange={value=>{setRange(value);rememberRange(value);}}/><div className="mp-toolbar"><p>登録した事業を横断して確認します。数値の定義が異なる可能性があるため、金額は自動合算しません。</p><button disabled={!data} onClick={()=>setRetry(value=>value+1)}>最新の状態を取得</button></div>
 {error&&<div role="alert" className="ao-error">{error}<button onClick={()=>setRetry(value=>value+1)}>再試行</button></div>}{!data&&!error&&<p role="status">{kindName}の総合ダッシュボードを読み込み中…</p>}
 {data&&<><div className="summary-cards secondary" aria-label={`${kindName}の集計`}><article><small>登録した{itemName}</small><strong><DetailValue label="登録した事業" onClick={()=>showBusinesses('登録した事業',rows)}>{rows.length}<em>件</em></DetailValue></strong></article><article><small>期間内に実績がある{itemName}</small><strong><DetailValue label="実績がある事業" onClick={()=>showBusinesses('実績がある事業',rows.filter(b=>(b.metrics?.records??0)>0))}>{withRecords}<em>件</em></DetailValue></strong></article><article><small>最新の実績日</small><strong><DetailValue label="最新の実績日" onClick={()=>showBusinesses('最新の実績がある事業',rows.filter(b=>latest&&b.metrics?.latest===latest))}>{latest??'未取得'}</DetailValue></strong></article></div>
 <CompanyCharts data={data} onOpen={id=>scope.choose(id)} onDetail={(id,key)=>{const b=rows.find(b=>b.id===id);if(b)showMetric(b,key);}}/>
 {!rows.length?<div className="mp-empty"><h3>{itemName}がまだありません</h3><p>上の「＋ {itemName}を追加」から専用画面を発行できます。</p></div>:<><div className="mp-toolbar"><h3>{itemName}別の状況</h3><span className="mp-muted">{range.start}〜{range.end}</span></div><div className="mp-table category-business-table"><table><thead><tr><th>{itemName}</th><th>確定売上</th><th>広告費</th><th>成約</th><th>記録</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map(b=><tr key={b.id}><th>{b.name}{b.restrictedProjects&&<small>許可された案件のみ</small>}</th><td>{b.metrics?<DetailValue label={b.name+'の'+companyMetrics.revenue.label} onClick={()=>showMetric(b,'revenue')}>{number(b.metrics.revenue)}</DetailValue>:'閲覧対象外'}{b.metrics?.revenue!=null&&' 円'}</td><td>{b.metrics?<DetailValue label={b.name+'の'+companyMetrics.cost.label} onClick={()=>showMetric(b,'cost')}>{number(b.metrics.cost)}</DetailValue>:'閲覧対象外'}{b.metrics?.cost!=null&&' 円'}</td><td>{b.metrics?<DetailValue label={b.name+'の'+companyMetrics.sales.label} onClick={()=>showMetric(b,'sales')}>{number(b.metrics.sales)}</DetailValue>:'閲覧対象外'}{b.metrics?.sales!=null&&' 件'}</td><td>{b.metrics?<><span><DetailValue label={b.name+'の記録'} onClick={()=>showMetric(b,'revenue')}>{b.metrics.records}記録・{b.metrics.days}日分</DetailValue></span><small>最終：{b.metrics.latest??'なし'}</small></>:'詳細分析の権限なし'}</td><td><button onClick={()=>scope.choose(b.id)}>この{itemName}を開く</button></td></tr>)}</tbody></table></div></>}
 </>}{detail.drawer}</section>;
}
