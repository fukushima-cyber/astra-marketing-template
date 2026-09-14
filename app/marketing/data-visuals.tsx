'use client';
import {useState} from 'react';
import {DataChart, SelectableChart} from '../components/data-charts';
import {countCategories} from '@/lib/chart-model';
import type {ChartSeries} from '@/lib/chart-model';
import {group, measures, total, type Fact, type Axis, type Measure} from '@/lib/analytics/model';
import {goalProgress, campaignPhase, phaseNames} from '@/lib/marketing-business/planning';
import {metricNames, metricUnit, type BusinessData, type BusinessGoal, type Campaign, type Observation} from '@/lib/marketing-business/types';
import type {Account, SourceGroup} from '@/lib/connected/model';
import type {PostizDraft} from '@/lib/postiz/types';

export function CountChart({title, values, names, note}: {title: string; values: string[]; names?: Record<string, string>; note?: string}) {
  return <DataChart title={title} points={countCategories(values, v => v, names)} note={note}/>;
}
export function FactCharts({rows, axis = 'funnelId', label, title = '実績', onSelect}: {rows: Fact[]; axis?: Axis; label?: (id: string) => string; title?: string; onSelect?: (id: string) => void}) {
  function series(by: Axis): ChartSeries[] {
    return (Object.keys(measures) as Measure[]).map(metric => ({id: metric, label: measures[metric], unit: ['sales', 'registrations'].includes(metric) ? '件' : '円', points: group(rows, by).map(([id, records]) => {
      const value = total(records, metric);
      return {id, label: by === 'date' ? id : label?.(id) ?? (by === 'funnelId' ? records[0].funnel.name : id), date: by === 'date' ? id : undefined, value: value.value, partial: value.missing > 0};
    })}));
  }
  return <div className="dc-layout"><SelectableChart title={`${title}の日別推移`} series={series('date')} kind="line" note="選択した条件の記録だけを集計。未取得は0に置き換えません。"/><SelectableChart title={`${title}の比較`} series={series(axis)} onSelect={onSelect} note="出典・定義が異なる記録を含む場合があります。明細と併せて確認してください。"/></div>;
}
export function CampaignCharts({campaigns, note = '現在の施策の状況です。作業完了と成果の達成は別に扱います。'}: {campaigns: Campaign[]; note?: string}) {
  return <div className="dc-layout"><CountChart title="施策の作業状況" values={campaigns.map(campaignPhase)} names={phaseNames} note={note}/><CountChart title="施策の結果判断" values={campaigns.map(c => c.result)} names={{pending:'判断保留',continue:'継続',change:'変更',stop:'停止'}} note={note}/></div>;
}
export function GoalChart({goals, observation}: {goals: BusinessGoal[]; observation?: Observation}) {
  return <DataChart title="目標ごとの改善進捗" unit="%" maximum={100} note="100%が目標。比較条件を確認した観測だけを使います。未判定は棒を表示しません。" points={goals.map(g => {const p = goalProgress(g, observation); return {id: g.id, label: g.title, value: p.value, note: p.reason ?? `目標 ${g.target.toLocaleString('ja-JP')}${metricUnit(g.metric)}`};})}/>;
}
export function ObservationChart({rows, selected}: {rows: Observation[]; selected?: string}) {
  const [id, setId] = useState('');
  const row = rows.find(o => o.id === (selected ?? id)) ?? rows.at(-1);
  const fields = {visitors:'ページ訪問者',registrations:'登録者',bookings:'予約者',meetings:'商談者',conversions:'成約者'} as const;
  return <div>{selected === undefined && <label>グラフで見る観測<select value={row?.id ?? ''} onChange={e => setId(e.target.value)}>{rows.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}<div className="dc-layout"><DataChart title="観測した段階別の人数" unit="人" points={row ? Object.entries(fields).map(([key, label]) => ({id:key,label,value:row[key as keyof typeof fields]})) : []} note={row ? `${row.label} / ${row.start}〜${row.end} / ${row.days}日観測。別の集団は合算しません。` : undefined}/><SelectableChart title="観測した金額" series={(['revenue','adSpend','grossProfit'] as const).map(key => ({id:key,label:({revenue:'売上',adSpend:'広告費',grossProfit:'粗利'})[key],unit:'円',points:row ? [{id:row.id,label:row.label,value:row[key],note:row.source || '出典未登録'}] : []}))}/></div></div>;
}
export function BusinessCharts({data, section, observation}: {data: BusinessData; section?: string; observation?: string}) {
  if (section === 'observations') return <ObservationChart rows={data.observations} selected={observation}/>;
  if (section === 'campaigns') return <CampaignCharts campaigns={data.campaigns}/>;
  if (section === 'funnels' || !section) return <div className="dc-layout"><DataChart title="案件ごとのファネル登録数" points={(data.projects ?? []).map(p => ({id:p.id,label:p.name,value:(data.funnels ?? []).filter(f => f.projectId === p.id).length}))} note="登録された構成の件数です。実績・成約数ではありません。"/><DataChart title="ファネルの段階数" points={(data.funnels ?? []).map(f => ({id:f.id,label:f.name,value:f.stages.length}))} note="分岐・合流を含む登録済みの段階数です。"/></div>;
  return <div className="dc-layout"><GoalChart goals={data.goals} observation={data.observations.find(o => o.id === observation) ?? data.observations.at(-1)}/><CountChart title="設定した目標の指標" values={data.goals.map(g => g.metric)} names={metricNames}/></div>;
}
export function DraftCharts({drafts}: {drafts: PostizDraft[]}) {
  return <div className="dc-layout"><CountChart title="下書きの確認状況" values={drafts.map(d => d.reviewState ?? 'editing')} names={{editing:'編集中',pending:'確認待ち',changes:'差し戻し',rejected:'却下'}} note="画面に読み込んだ下書きの状況です。公開済みの投稿数ではありません。"/><CountChart title="下書きの投稿先" values={drafts.map(d => d.platform ?? '未登録')} names={{x:'X',threads:'Threads',instagram:'Instagram',youtube:'YouTube'}}/></div>;
}
export function ConnectionChart({connections}: {connections: {enabled: number | boolean; last_success: string | null; last_error: string | null}[]}) {
  return <CountChart title="データ接続の取得状況" values={connections.map(c => !c.enabled ? '停止中' : c.last_error ? '取得エラー' : c.last_success ? '取得記録あり' : 'まだ未取得')} note="保存された最終取得の状態です。最新の疎通を保証するものではありません。"/>;
}
export function NativeCharts({accounts, groups, start, end}: {accounts: Account[]; groups: SourceGroup[]; start: string; end: string}) {
  return <div className="dc-layout"><SelectableChart title="SNSフォロワーの推移" kind="line" series={accounts.map(a => ({id:a.id,label:a.displayName || a.handle,unit:'人',points:a.series.filter(d => d.date >= start && d.date <= end).map(d => ({id:d.date,date:d.date,label:d.date,value:d.followers}))}))} note="各アカウントの取得日の値です。日別の値やアカウント間の人数は合算しません。"/><SelectableChart title="UTAGEの日別記録" kind="line" series={groups.flatMap(g => (['pv','registrationCount'] as const).map(key => ({id:g.id+key,label:`${g.displayName} / ${key === 'pv' ? 'ページ表示' : '登録'}`,unit:key === 'pv' ? '回' : '件',points:g.series.filter(d => d.date >= start && d.date <= end).map(d => ({id:d.date,date:d.date,label:d.date,value:d[key]}))})))} note="保存された日次記録。ページをまたぐ個人の重複排除はしていません。"/></div>;
}
