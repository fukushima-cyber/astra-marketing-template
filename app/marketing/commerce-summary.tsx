'use client';
import {MetricIcon} from '../components/dashboard-ui';
import {useEffect,useState} from 'react';
import {useBusinessFetch,usePageAccess} from './business-context';
import {DetailValue,useDataDetail} from './data-detail';
import {commerceDetailRows} from '@/lib/data-detail';
import {commerceTotals,type Sale} from '@/lib/commerce';
export default function CommerceSummary({start,end,refresh,onOpen}:{start:string;end:string;refresh:number;onOpen:()=>void}){
 const detail=useDataDetail(),[entries,setEntries]=useState<Sale[]>([]);
 const fetch=useBusinessFetch(),access=usePageAccess('business'),[totals,setTotals]=useState<ReturnType<typeof commerceTotals>|null>(null),[error,setError]=useState('');
 useEffect(()=>{setTotals(null);setEntries([]);detail.show(null);setError('');if(!access)return;const c=new AbortController();void fetch('/api/marketing/commerce?'+new URLSearchParams({start,end}),{signal:c.signal,cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);if(!c.signal.aborted){setTotals(b.totals);setEntries(b.data.entries);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[fetch,access,start,end,refresh]);
 if(!access)return null;
 return <section aria-label="記帳した売上"><div className="mp-toolbar"><h3>記帳した売上</h3><button onClick={onOpen}>商品・売上へ</button></div>{error?<p role="alert">{error}</p>:totals?<><div className="summary-cards secondary">{([['gross','売上',totals.gross],['refunds','返金',totals.refunds],['fees','手数料',totals.fees],['pending','未入金',totals.pending]] as const).map(([key,label,value])=><article key={key}><small><MetricIcon metric={key==='gross'?'revenue':key==='refunds'?'refunds':'cost'}/>{label}</small><strong><DetailValue label={'記帳した'+label} onClick={()=>detail.show({title:'記帳した'+label,value:'¥'+value.toLocaleString('ja-JP'),context:[start+'〜'+end],columns:['日付','商品','種類','売上・返金（円）','手数料（円）','状態','注文番号','メモ'],rows:commerceDetailRows(entries,key,start,end).map(e=>[e.date,e.productName,e.kind==='sale'?'売上':'返金',e.amount,e.fee,e.payment==='paid'?'処理済':'未処理',e.reference,e.notes]),note:'記帳済みの範囲。APIやCSVの実績とは合算しません。'})}>¥{value.toLocaleString('ja-JP')}</DetailValue></strong></article>)}</div><small>{totals.records}件の記帳 / 他の取得元と合算しません</small></>:<p role="status">記帳した売上を読み込み中…</p>}{detail.drawer}</section>;
}
