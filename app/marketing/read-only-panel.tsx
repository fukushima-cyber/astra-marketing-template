'use client';
import {DraftCharts,ConnectionChart,BusinessCharts} from './data-visuals';
import {useEffect,useState} from 'react';
import {useBusinessFetch} from './business-context';
import type {BusinessData} from '@/lib/marketing-business/types';
import type {PostizDraft} from '@/lib/postiz/types';
type Connection={id:string;label:string;provider:string;enabled:number;last_success:string|null;last_error:string|null};
export default function ReadOnlyPanel({page,section}:{page:'business'|'posts'|'connections';section?:string}){
 const fetch=useBusinessFetch(),[data,setData]=useState<{data?:BusinessData;drafts?:PostizDraft[];connections?:Connection[]}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');fetch(page==='posts'?'/api/marketing/postiz?action=drafts':'/api/marketing/'+page,{signal:controller.signal,cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);return b;}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[page,retry,fetch]);
 return <section><p>閲覧のみの権限です。保存・変更はできません。</p><div className="ao-actions"><button onClick={()=>setRetry(n=>n+1)}>最新の情報を取得</button></div>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">読み込み中…</p>}
 {data?.drafts&&<DraftCharts drafts={data.drafts}/>}
 {data?.connections&&<ConnectionChart connections={data.connections}/>}
 {data?.data&&<BusinessCharts data={data.data} section={section==='goal-settings'?'settings':section}/>}
 {data?.drafts&&<>{data.drafts.length===0&&<p>保存された投稿はまだありません。</p>}{data.drafts.map(d=><article className="co-card" key={d.id}><h3>{d.title}</h3><p>{d.platform} / {d.scheduleAt??'日時未設定'}</p><p style={{whiteSpace:'pre-wrap'}}>{d.content}</p><small>更新：{d.updatedAt}</small></article>)}</>}
 {data?.connections&&<>{data.connections.length===0&&<p>データ接続はまだありません。</p>}{data.connections.filter(c=>section==='sns'?c.provider!=='utage':section==='utage'?c.provider==='utage':true).map(c=><article className="co-card" key={c.id}><h3>{c.label}</h3><p>{c.provider} / {c.enabled?'取得可能':'停止中'}</p><p>最終取得：{c.last_success??'未取得'}</p>{c.last_error&&<p>{c.last_error}</p>}</article>)}</>}
 {data?.data&&<>{section==='goal-settings'&&<><h3>{data.data.name||'事業の目標'}</h3><p>{data.data.objective||'目標はまだ登録されていません。'}</p>{data.data.goals.map(g=><article className="co-card" key={g.id}><h4>{g.title}</h4><p>基準：{g.baseline} / 目標：{g.target} / 期限：{g.deadline}</p></article>)}</>}{section!=='observations'&&section!=='goal-settings'&&<><h3>案件とファネル</h3>{data.data.projects?.map(p=><article className="co-card" key={p.id}><h4>{p.name}</h4>{data.data!.funnels?.filter(f=>f.projectId===p.id).map(f=><p key={f.id}>{f.name}：{f.stages.map(s=>s.name).join(' → ')}</p>)}</article>)}</>}{section==='observations'&&<><h3>観測データ</h3>{data.data.observations.map(o=><details key={o.id}><summary>{o.label} / {o.start}〜{o.end}</summary><p>出典：{o.source}</p><p>売上：{o.revenue??'未取得'} / 成約：{o.conversions??'未取得'} / 広告費：{o.adSpend??'未取得'}</p></details>)}</>}</>}
 </section>;
}
