'use client';
import {Banknote, Users, MousePointer2, Megaphone, ShoppingBag, RotateCcw, Wallet, BarChart3} from 'lucide-react';
import type {ChartPoint} from '@/lib/chart-model';
import {donutParts} from '@/lib/dashboard-model';
export function MetricIcon({metric}:{metric:string}){
 const Icon=({revenue:Banknote,payments:Wallet,cost:Megaphone,refunds:RotateCcw,registrations:Users,sales:ShoppingBag,clicks:MousePointer2,impressions:BarChart3} as Record<string,typeof Banknote>)[metric]??BarChart3;
 return <span className={'dash-icon dash-icon-'+metric} aria-hidden="true"><Icon size={18}/></span>;
}
export function BreakdownChart({title,points,unit,onSelect}:{title:string;points:ChartPoint[];unit:string;onSelect?:(id:string)=>void}){
 const {parts,total,missing,invalid}=donutParts(points),colors=['#3978e5','#36a886','#8273cf','#df9553','#7c899b'];
 let at=0;const gradient=parts.map((p,i)=>{const from=at;at+=p.value/total*100;return `${colors[i%colors.length]} ${from}% ${at}%`;}).join(',');
 return <section className="dc-chart dash-breakdown"><h4>{title}</h4>{missing||invalid?<p className="dc-empty">{invalid?'負の値を含むため構成比を表示できません。':'一部未取得のため構成比を表示できません。'}</p>:total>0?<div className="dash-donut-layout"><div className="dash-donut" aria-hidden="true" style={{background:`conic-gradient(${gradient})`}}><span><small>合計</small><strong>{total.toLocaleString('ja-JP',{maximumFractionDigits:1})}</strong><small>{unit}</small></span></div><ul className="dash-legend">{parts.map((p,i)=><li key={p.id}><i aria-hidden="true" style={{background:colors[i%colors.length]}}/>{onSelect?<button onClick={()=>onSelect(p.id)}>{p.label}</button>:<span>{p.label}</span>}<strong>{(p.value/total*100).toFixed(1)}%</strong><small>{p.value.toLocaleString('ja-JP',{maximumFractionDigits:1})} {unit}</small></li>)}</ul></div>:<p className="dc-empty">{points.length?'記録された合計は0です。':'表示できる記録はまだありません。'}</p>}</section>;
}
