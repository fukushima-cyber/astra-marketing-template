'use client';

import {useEffect, useRef, useState} from 'react';
import {MetricIcon} from '../components/dashboard-ui';
import {DetailValue} from '../marketing/data-detail';
import {companyMetrics, dailySegments, partialMetric} from '@/lib/company';
import type {CompanyMetric, CompanySummary, CompanyBusiness} from '@/lib/company';

const format = (value: number) => value.toLocaleString('ja-JP', {maximumFractionDigits: 2});
const compact = (value: number) => new Intl.NumberFormat('ja-JP', {notation: 'compact', maximumFractionDigits: 1}).format(value);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Trend({business, metric, start, end,onDetail}: {onDetail?:(day:string)=>void;business: CompanyBusiness; metric: CompanyMetric; start: string; end: string}) {
  const [active, setActive] = useState<{date: string; value: number; partial: boolean} | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const days = business.daily ?? [];
  const segments = dailySegments(days, metric);
  const points = segments.flat();
  const definition = companyMetrics[metric];
  const min = points.reduce((n, p) => Math.min(n, p.value), 0);
  const max = points.reduce((n, p) => Math.max(n, p.value), 0) || 1;
  const x = (date: string) => start === end ? (64 + width - 24) / 2 : 64 + (Date.parse(date) - Date.parse(start)) / (Date.parse(end) - Date.parse(start)) * (width - 88);
  const y = (value: number) => 226 - (value - min) / (max - min) * 194;
  const current = active ?? points[points.length - 1];
  const ticks = [max, min + (max - min) / 2, min];
  if (!points.length) return <div className="co-chart-empty"><strong>この期間の{definition.label}は未取得です</strong><p>記録が取り込まれると、日別の推移が表示されます。</p></div>;
  return <>
    <div className="co-chart-scroll" ref={plot}>
      <svg className="co-trend" viewBox={`0 0 ${width} 264`} role={onDetail?'group':'img'} aria-label={`${business.name}の${definition.label}の日別推移。${start}から${end}。正確な数値は下の日別データで確認できます。`}>
        {ticks.map((tick, i) => <g key={i}><line className="co-chart-grid" x1="64" x2={width - 24} y1={y(tick)} y2={y(tick)}/><text x="54" y={y(tick) + 4} textAnchor="end">{compact(tick)}</text></g>)}
        <text x="64" y="18">{definition.unit}</text>
        {min < 0 && <line className="co-chart-zero" x1="64" x2={width - 24} y1={y(0)} y2={y(0)}/>}
        {segments.map((segment, i) => <g key={i}><polygon fill="#3978e51c" points={`${x(segment[0].date)},${y(0)} ${segment.map(p=>`${x(p.date)},${y(p.value)}`).join(' ')} ${x(segment.at(-1)!.date)},${y(0)}`}/><polyline className="co-chart-line" points={segment.map(p => `${x(p.date)},${y(p.value)}`).join(' ')}/></g>)}
        {points.map(p => <circle key={p.date} className={`co-chart-point${p.partial ? ' is-partial' : ''}`} cx={x(p.date)} cy={y(p.value)} r="4.5" tabIndex={0} role={onDetail?'button':'graphics-symbol'} onClick={()=>onDetail?.(p.date)} onKeyDown={e=>{if(onDetail&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onDetail(p.date);}}} style={onDetail?{cursor:'pointer'}:undefined} aria-label={`${p.date}、${format(p.value)}${definition.unit}${p.partial ? '、一部未取得' : ''}`} onFocus={() => setActive(p)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(p)} onMouseLeave={() => setActive(null)}>
          <title>{p.date}：{format(p.value)} {definition.unit}{p.partial ? '（一部未取得）' : ''}</title>
        </circle>)}
        <text x={start === end ? (64 + width - 24) / 2 : 64} y="254" textAnchor={start === end ? 'middle' : 'start'}>{shortDate(start)}</text>
        {start !== end && <text x={width - 24} y="254" textAnchor="end">{shortDate(end)}</text>}
      </svg>
    </div>
    <p className="co-chart-readout" aria-live="polite"><span>{current.date}</span><strong>{format(current.value)} <small>{definition.unit}</small></strong>{current.partial && <span className="co-warning">一部未取得</span>}</p>
    <details className="co-chart-details"><summary>日別データを見る（{days.length}日分）</summary><div className="co-table"><table><caption>{business.name}の{definition.label}・記録のある日</caption><thead><tr><th scope="col">日付</th><th scope="col">{definition.label}（{definition.unit}）</th><th scope="col">取得状況</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{onDetail?<DetailValue label={day.date+'の'+definition.label} onClick={()=>onDetail(day.date)}>{day[metric] === null ? '未取得' : format(day[metric])}</DetailValue>:day[metric] === null ? '未取得' : format(day[metric])}</td><td>{day[metric] === null ? '未取得' : partialMetric(day, metric) ? '一部未取得' : '登録済みの記録を集計'}</td></tr>)}</tbody></table></div></details>
  </>;
}

export default function CompanyCharts({data, onOpen,onDetail}: {onDetail?:(id:string,key:CompanyMetric,day?:string)=>void;data: CompanySummary; onOpen: (id: string) => void}) {
  const [metric, setMetric] = useState<CompanyMetric>('revenue');
  const [businessId, setBusinessId] = useState('');
  const visible = data.businesses.filter(b => b.metrics !== null);
  const selected = visible.find(b => b.id === businessId) ?? visible[0];
  const definition = companyMetrics[metric];
  const min = visible.reduce((n, b) => Math.min(n, b.metrics?.[metric] ?? 0), 0);
  const max = visible.reduce((n, b) => Math.max(n, b.metrics?.[metric] ?? 0), 0) || 1;
  const position = (value: number) => (value - min) / (max - min) * 100;
  const zero = position(0);
  if (!visible.length) return null;
  return <section className="co-charts" aria-labelledby="co-charts-title">
    <div className="co-heading"><div><h2 id="co-charts-title">実績をグラフで見る</h2><p className="co-muted">{data.start} 〜 {data.end} · 未取得を0として補わず、記録のある範囲を表示します。</p></div><label className="co-chart-metric">表示する指標<select value={metric} onChange={e => setMetric(e.target.value as CompanyMetric)}>{(Object.keys(companyMetrics) as CompanyMetric[]).map(key => <option key={key} value={key}>{companyMetrics[key].label}</option>)}</select></label></div>
    <label className="co-chart-business">主要な数字を見る事業<select value={selected.id} onChange={e=>setBusinessId(e.target.value)}>{visible.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><div className="dash-kpi-grid" aria-label={selected.name+'の主要な数字'}>{(Object.keys(companyMetrics) as CompanyMetric[]).map(key=><article className="dash-kpi" key={key}><span><MetricIcon metric={key}/>{companyMetrics[key].label}</span><strong>{onDetail?<DetailValue label={selected.name+'の'+companyMetrics[key].label} onClick={()=>onDetail(selected.id,key)}>{selected.metrics![key]===null?'未取得':format(selected.metrics![key]!)}</DetailValue>:selected.metrics![key]===null?'未取得':format(selected.metrics![key]!)}</strong><small>{selected.name} / {companyMetrics[key].unit}{partialMetric(selected.metrics!,key)?' / 一部未取得':''}</small></article>)}</div>
    <div className="co-chart-layout">
      <article className="co-card co-chart-card">
        <div className="co-heading"><div><h3>日別の推移</h3><p className="co-muted">{definition.label} · 日ごとの実績</p></div><label className="co-chart-business">推移を見る事業<select value={selected.id} onChange={e => setBusinessId(e.target.value)}>{visible.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label></div>
        <div className="co-chart-total"><strong>{onDetail?<DetailValue label={selected.name+'の'+definition.label} onClick={()=>onDetail(selected.id,metric)}>{selected.metrics![metric] === null ? '未取得' : format(selected.metrics![metric]!)}</DetailValue>:selected.metrics![metric] === null ? '未取得' : format(selected.metrics![metric]!)}</strong>{selected.metrics![metric] !== null && <span>{definition.unit}</span>}<span>期間内の記録合計</span>{partialMetric(selected.metrics!, metric) && <span className="co-warning">一部未取得</span>}</div>
        {selected.restrictedProjects && <p className="co-muted">許可された案件のみの実績です。</p>}
        {selected.metrics!.definitions > 1 && <p className="co-warning co-chart-notice">集計定義が複数含まれます。詳細で定義を確認してください。</p>}
        <Trend key={`${selected.id}:${metric}:${data.start}:${data.end}`} onDetail={onDetail?day=>onDetail(selected.id,metric,day):undefined} business={selected} metric={metric} start={data.start} end={data.end}/>
        <p className="co-muted">記録のない日・未取得の日は線をつなぎません。白抜きの点は一部未取得です。</p>
      </article>
      <article className="co-card co-chart-card"><h3>事業別の比較</h3><p className="co-muted">{definition.label}（{definition.unit}）· 期間内の記録合計</p>
        <ul className="co-bars">{visible.map(b => {
          const value = b.metrics![metric];
          return <li key={b.id}><button className="co-bar-button" onClick={() => onDetail?onDetail(b.id,metric):onOpen(b.id)} aria-label={`${b.name}の${definition.label}の詳細を開く`}><span className="co-bar-heading"><span>{b.name}</span><strong>{value === null ? '未取得' : `${format(value)} ${definition.unit}`} <span aria-hidden="true">→</span></strong></span>{value !== null && <span className="co-bar-track" aria-hidden="true"><span className="co-bar-zero" style={{left: `${zero}%`}}/><span className={`co-bar-fill${partialMetric(b.metrics!, metric) ? ' is-partial' : ''}`} style={{left: `${Math.min(zero, position(value))}%`, width: `${Math.abs(position(value) - zero)}%`}}/></span>}<span className="co-bar-notes">{partialMetric(b.metrics!, metric) && <span className="co-warning">一部未取得</span>}{b.restrictedProjects && <span>許可された案件のみ</span>}{b.metrics!.definitions > 1 && <span className="co-warning">集計定義が複数</span>}</span></button></li>;
        })}</ul>
        <p className="co-muted">事業名から同じ期間の内訳へ進めます。比較する際は、各事業の出典・定義・取得範囲を確認してください。</p>
      </article>
    </div>
  </section>;
}
