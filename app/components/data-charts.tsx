'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {chartBounds, chartSegments, finiteValue} from '@/lib/chart-model';
import type {ChartPoint, ChartSeries} from '@/lib/chart-model';
import './data-charts.css';
const fmt = (value: number | null) => value === null ? '未取得' : value.toLocaleString('ja-JP', {maximumFractionDigits: 2});
const compact = (value: number) => value.toLocaleString('ja-JP', {notation: 'compact', maximumFractionDigits: 1});

export function DataChart({title, points, unit = '件', kind = 'bar', note, onSelect, maximum, empty = '表示できるデータはまだありません。'}: {
  title: string; points: ChartPoint[]; maximum?: number; unit?: string; kind?: 'bar' | 'line'; note?: string; onSelect?: (id: string) => void; empty?: string;
}) {
  const id = useId(), plot = useRef<HTMLDivElement>(null), [width, setWidth] = useState(600), [active, setActive] = useState<ChartPoint | null>(null);
  const data = points.map(p => ({...p, value: finiteValue(p.value)}));
  const dated = kind === 'line' && data.every(p => p.date && Number.isFinite(Date.parse(p.date)));
  const sorted = dated ? [...data].sort((a, b) => a.date!.localeCompare(b.date!)) : data;
  const bounds = chartBounds(data), min = bounds.min, max = Math.max(bounds.max, maximum ?? bounds.max), known = data.some(p => p.value !== null);
  const position = (v: number) => (v - min) / (max - min) * 100, zero = position(0);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, [known, kind]);
  const start = sorted[0]?.date, end = sorted.at(-1)?.date;
  const x = (p: ChartPoint) => start === end ? width / 2 + 16 : 56 + (Date.parse(p.date!) - Date.parse(start!)) / (Date.parse(end!) - Date.parse(start!)) * (width - 80);
  const y = (v: number) => 200 - position(v) * 1.7;
  const current = sorted.find(p => p.id === active?.id && p.value === active.value) ?? [...sorted].reverse().find(p => p.value !== null);
  return <section className="dc-chart" aria-labelledby={id}>
    <h4 id={id}>{title}</h4>{note && <p className="dc-note">{note}</p>}
    {!data.length ? <p className="dc-empty">{empty}</p> : <>
      {kind === 'line' && dated && known ? <>
        <div className="dc-plot" ref={plot}><svg viewBox={`0 0 ${width} 232`} role="img" aria-label={`${title}（${unit}）。正確な数値は下のデータ表で確認できます。`}>
          {[max, min + (max - min) / 2, min].map((tick, i) => <g key={i}><line x1="56" x2={width - 24} y1={y(tick)} y2={y(tick)} className="dc-grid"/><text x="48" y={y(tick) + 4} textAnchor="end">{compact(tick)}</text></g>)}
          <text x="56" y="17">{unit}</text>
          {chartSegments(sorted).map((segment, i) => <polyline key={i} className="dc-line" points={segment.map(p => `${x(p)},${y(p.value!)}`).join(' ')}/>)}
          {sorted.filter(p => p.value !== null).map(p => <circle className={`dc-point${p.partial ? ' dc-partial' : ''}`} key={p.id} cx={x(p)} cy={y(p.value!)} r="4" tabIndex={0} aria-label={`${p.label}：${fmt(p.value)}${unit}${p.partial ? '、一部未取得' : ''}`} onFocus={() => setActive(p)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(p)} onMouseLeave={() => setActive(null)}><title>{p.label}：{fmt(p.value)} {unit}</title></circle>)}
          <text x="56" y="226">{start?.slice(5).replace('-', '/')}</text>{start !== end && <text x={width - 24} y="226" textAnchor="end">{end?.slice(5).replace('-', '/')}</text>}
        </svg></div>
        <p className="dc-readout" aria-live="polite">{current?.label} <strong>{fmt(current?.value ?? null)} {unit}</strong>{current?.partial && <span>一部未取得</span>}</p>
        <p className="dc-note">未記録・未取得の日は線をつなぎません。白抜きの点は一部未取得です。</p>
      </> : <ul className="dc-bars">{data.map(p => <li key={p.id}><div className="dc-row">{onSelect ? <button type="button" onClick={() => onSelect(p.id)}>{p.label}</button> : <span>{p.label}</span>}<strong>{fmt(p.value)}{p.value !== null && ` ${unit}`}</strong></div>{p.value !== null && <div className="dc-track" aria-hidden="true"><span className="dc-zero" style={{left: `${zero}%`}}/><i className={p.partial ? 'dc-partial' : ''} style={{left: `${Math.min(zero, position(p.value))}%`, width: `${Math.abs(position(p.value) - zero)}%`}}/></div>}{(p.partial || p.note) && <small>{p.partial && '一部未取得'}{p.partial && p.note && ' / '}{p.note}</small>}</li>)}</ul>}
      <details className="dc-data"><summary>グラフのデータを見る（{data.length}件）</summary><div className="dc-table"><table><thead><tr><th scope="col">項目</th><th scope="col">値（{unit}）</th><th scope="col">補足</th></tr></thead><tbody>{sorted.map(p => <tr key={p.id}><th scope="row">{p.label}</th><td>{fmt(p.value)}</td><td>{[p.partial ? '一部未取得' : '', p.note].filter(Boolean).join(' / ') || '—'}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
export function SelectableChart({title, series, kind, note, onSelect}: {title: string; series: ChartSeries[]; kind?: 'bar' | 'line'; note?: string; onSelect?: (id: string) => void}) {
  const [selected, setSelected] = useState('');
  const value = series.find(s => s.id === selected) ?? series[0];
  return <div className="dc-selectable"><label>{title}の指標<select value={value?.id ?? ''} onChange={e => setSelected(e.target.value)} disabled={!series.length}>{series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><DataChart key={value?.id} title={`${title}${value ? ' / ' + value.label : ''}`} points={value?.points ?? []} unit={value?.unit} kind={kind} note={note} onSelect={onSelect}/></div>;
}
