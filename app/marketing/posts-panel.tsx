'use client';
import {DetailValue,useDataDetail} from './data-detail';
import {numericValue} from '@/lib/chart-model';
import {DraftCharts} from './data-visuals';
import {SelectableChart} from '../components/data-charts';
import {useBusinessFetch} from './business-context';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PostizAnalyticsSeries, PostizDraft, PostizIntegration, PostizPost } from '@/lib/postiz/types';
import { SNS_PLATFORMS, snsPlatform } from '@/lib/postiz/platforms';
import MediaPicker, { MediaPreview } from './media-picker';
import PostCalendar from './post-calendar';
import type { MediaAsset } from '@/lib/postiz/media';
import { publicationSpec } from '@/lib/postiz/publication';
import './posts.css';

type Props = { goalId: string; initialContent?: string; transferKey?: number; onDirtyChange?:(dirty:boolean)=>void };
type Account = PostizIntegration;
type RemotePost = PostizPost;
type Analytics = PostizAnalyticsSeries[];
type Draft = PostizDraft & { accountId: string; scheduledAt: string };
type PostsSnapshot = { configured: boolean; accounts: Account[]; posts: RemotePost[] };
type Action = 'save-draft' | 'postiz-draft' | 'schedule';

const POSTIZ_SIGNUP_URL = 'https://postiz.bonkers.llc/launches';
const localDate = (value?:string) => { if(!value)return ''; const d=new Date(value); return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):''; };
const isoDate = (value:string) => value ? new Date(value).toISOString() : undefined;
const metricLabels:Record<string,string>={likes:'いいね',comments:'コメント',shares:'共有',impressions:'表示回数',reach:'届いた人数',clicks:'クリック',engagements:'反応',views:'閲覧数',followers:'フォロワー'};
const syncLabels:Record<string,string>={local:'下書き',submitting:'送信処理中',synced:'Postizへ保存済み',unknown:'結果の確認が必要',failed:'送信失敗'};
const emptyDraft = (goalId: string, content = ''): Draft => ({
  id: `draft-${crypto.randomUUID()}`, version: 0,
  platform:'x',assetIds:[],options:{},reviewState:'editing',title: '新しい投稿', content, goalId, accountId: '', channelId: '', scheduleAt: undefined, scheduledAt: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), remotePostIds: [], syncStatus: 'local',
});
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP') : '未設定';
const statusLabel: Record<string, string> = { draft: '下書き', scheduled: '予約済み', published: '公開済み', failed: '失敗', pending: '処理中', queue:'予約済み', error:'失敗' };
const isSelectableAccount = (account: Account) => !account.disabled;
const safeUrl = (value?: string | null) => { try { const url = new URL(value ?? ''); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; } };
const normalizeDraft = (value: Partial<Draft> & { channelId?: string; scheduleAt?: string }): Draft => ({
  platform:value.platform??'x',assetIds:value.assetIds??[],options:value.options??{},reviewState:value.reviewState??'editing',reviewNote:value.reviewNote,history:value.history,
  id: value.id ?? `draft-${crypto.randomUUID()}`, version: Number.isSafeInteger(value.version) ? value.version! : 0,
  title: value.title ?? '新しい投稿', content: value.content ?? '', goalId: value.goalId ?? '', accountId: value.accountId ?? value.channelId ?? '', channelId: value.channelId ?? value.accountId ?? '', scheduleAt: value.scheduleAt ?? value.scheduledAt, scheduledAt: value.scheduledAt ?? localDate(value.scheduleAt), createdAt: value.createdAt ?? new Date().toISOString(), updatedAt: value.updatedAt ?? new Date().toISOString(), remotePostIds: value.remotePostIds ?? [], syncStatus: value.syncStatus ?? 'local', syncMode: value.syncMode,
});

export default function PostsPanel({ goalId, initialContent = '', transferKey,onDirtyChange }: Props) {
 const detail=useDataDetail();const fetch=useBusinessFetch();
  const [businessGoals,setBusinessGoals]=useState<Array<{id:string;title:string}>>([]);
  const goalOptions=businessGoals;
  const [assets,setAssets]=useState<MediaAsset[]>([]);
  const [cancelPreview,setCancelPreview]=useState(false);
  const [draftFilter,setDraftFilter]=useState('all');
  const [listQuery,setListQuery]=useState('');
  const [listPlatform,setListPlatform]=useState('all');
  const [listStatus,setListStatus]=useState('all');
  const [reviewNote,setReviewNote]=useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [snapshot, setSnapshot] = useState<PostsSnapshot>({ configured: false, accounts: [], posts: [] });
  const [selectedPost, setSelectedPost] = useState<RemotePost | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  useEffect(()=>{detail.show(null);},[selectedPost,analytics,fetch]);
  function showAnalytics(label:string,date?:string){const series=analytics?.find(s=>s.label===label);if(!series)return;detail.show({title:(metricLabels[label.toLowerCase()]??label)+' / '+(selectedPost?.content??''),context:[selectedPost?.integration.name??'投稿'],columns:['取得日','値'],rows:series.data.filter(d=>!date||d.date===date).map(d=>[d.date,numericValue(d.total)]),note:'取得元が返した投稿別の観測値です。累計値を日別に合算しません。'});}
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [postsPeriod, setPostsPeriod] = useState('接続後に取得期間を表示');
  const [remoteFailure, setRemoteFailure] = useState(false);
  const [preview, setPreview] = useState(false);
  const lastTransferKey = useRef<number | undefined>(undefined);
    const dirtyIds = useRef(new Set<string>());
  const pending = useRef<{ action: Action; requestId: string; signature: string } | null>(null);

  const selectedDraft = drafts.find((item) => item.id === selectedDraftId) ?? drafts[0] ?? null;
  const editable = !!selectedDraft && ['local','failed'].includes(selectedDraft.syncStatus);
  const dirty = !!selectedDraft && (selectedDraft.version===0 || dirtyIds.current.has(selectedDraft.id));
  const anyDirty=drafts.some(d=>dirtyIds.current.has(d.id)||(d.version===0&&!!d.content.trim()));
  useEffect(()=>{onDirtyChange?.(anyDirty);const guard=(e:BeforeUnloadEvent)=>{if(anyDirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>{onDirtyChange?.(false);window.removeEventListener('beforeunload',guard);};},[anyDirty,onDirtyChange]);
  const selectedAccount = snapshot.accounts.find((item) => item.id === selectedDraft?.accountId && isSelectableAccount(item));
  const goalTitle = (id: string) => goalOptions.find((goal) => goal.id === id)?.title ?? '目標未選択';

  const loadRemote = useCallback(async () => {
    setLoading(true);
    void fetch('/api/marketing/business').then(r=>r.json()).then(d=>{if(Array.isArray(d.data?.goals))setBusinessGoals(d.data.goals);}).catch(()=>{});
    const fetchData = async (action:string) => {
      const response=await fetch(`/api/marketing/postiz?action=${action}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||'投稿サービスの状態を取得できませんでした。');return data;
    };
    try {
      const data=await fetchData('drafts');
      const serverDrafts:Draft[]=data.drafts.map(normalizeDraft);
      setDrafts(current=>{
        const retained=current.map(d=>dirtyIds.current.has(d.id)||d.version===0?d:serverDrafts.find(x=>x.id===d.id)??d);
        const merged=[...retained,...serverDrafts.filter(d=>!retained.some(x=>x.id===d.id))];
        return merged.length?merged:[emptyDraft(goalId)];
      });
      const status=await fetchData('status');
      if(!status.configured){setSnapshot({configured:false,accounts:[],posts:[]});setRemoteFailure(false);setError('');return;}
      const now=Date.now(),start=new Date(now-30*86400000),end=new Date(now+30*86400000);
      const [accounts,posts]=await Promise.all([fetchData('integrations'),fetchData(`posts&startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`)]);
      setSnapshot({configured:true,accounts:accounts.integrations,posts:posts.posts});
      setPostsPeriod(`${start.toLocaleDateString('ja-JP')}〜${end.toLocaleDateString('ja-JP')}`);setRemoteFailure(false);setError('');
    }catch(e){setSnapshot({configured:false,accounts:[],posts:[]});setRemoteFailure(true);setError(e instanceof Error?e.message:'接続を確認できませんでした。');}
    finally{setLoading(false);}
  },[goalId]);

  useEffect(()=>{void fetch('/api/marketing/business').then(r=>r.json()).then(d=>{if(Array.isArray(d.data?.goals))setBusinessGoals(d.data.goals);}).catch(()=>{});},[goalId]);
  useEffect(() => { void loadRemote(); }, [goalId, loadRemote]);

  useEffect(() => {
    if (transferKey === undefined || transferKey === lastTransferKey.current || !initialContent.trim()) return;
    const draft = emptyDraft(goalId, initialContent);
    setDrafts((current) => [draft, ...current]); setSelectedDraftId(draft.id); setPreview(false); setNotice('成果物を新しい下書きへ移しました。内容を確認して保存してください。');
    lastTransferKey.current = transferKey;
  }, [goalId, initialContent, transferKey]);

  const updateDraft = (changes: Partial<Draft>) => {
    if (!selectedDraft || !editable || saving) return;
    setPreview(false);
    dirtyIds.current.add(selectedDraft.id);
    setDrafts((current) => current.map((item) => item.id === selectedDraft.id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
  };
  const createDraft = (date?:string) => { const draft = emptyDraft(goalId);if(date)draft.scheduledAt=date; setDrafts((current) => [draft, ...current]); setSelectedDraftId(draft.id); setPreview(false); };

  const perform = async (action: Action) => {
    if (!selectedDraft || saving || !editable) return;
    if(action!=='save-draft'&&dirty)return setError('編集内容を下書きに保存してから、もう一度確認してください。');
    if (action !== 'save-draft' && (!snapshot.configured || !selectedAccount)) return setError('接続先アカウントを選択してから実行してください。');
    if (action === 'schedule' && !selectedDraft.scheduledAt) return setError('予約日時を指定してください。');
    setSaving(true); setError(''); setNotice('');
    const apiAction = action === 'save-draft' ? 'save' : action === 'postiz-draft' ? 'submit' : 'schedule';
    const serverDraft = { platform:selectedDraft.platform,assetIds:selectedDraft.assetIds??[],options:selectedDraft.options??{},id:selectedDraft.version>0?selectedDraft.id:undefined,title:selectedDraft.title,content:selectedDraft.content,goalId:selectedDraft.goalId,channelId:selectedDraft.accountId||undefined,scheduleAt:isoDate(selectedDraft.scheduledAt) };
    const payloadSignature = JSON.stringify({ apiAction, draft: serverDraft, channelId: selectedDraft.accountId, scheduledAt: selectedDraft.scheduledAt, confirmed: action !== 'save-draft' });
    const requestId = pending.current?.action === action && pending.current.signature === payloadSignature ? pending.current.requestId : crypto.randomUUID();
    pending.current = { action, requestId, signature: payloadSignature };
    try {
      const body = action === 'save-draft'
        ? { action: apiAction, requestId, confirmed: false, draft: serverDraft, draftId: selectedDraft.id, expectedVersion: selectedDraft.version, version: selectedDraft.version, channelId: selectedDraft.accountId, scheduledAt: selectedDraft.scheduledAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : { action: apiAction, requestId, draftId: selectedDraft.id, expectedVersion: selectedDraft.version, confirmedSpec:publicationSpec(selectedDraft),confirmed: true, confirmedContent: selectedDraft.content, confirmedChannelId: selectedDraft.accountId, confirmedScheduleAt: isoDate(selectedDraft.scheduledAt), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      const response = await fetch('/api/marketing/postiz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),signal:AbortSignal.timeout(15000) });
      const data = (await response.json()) as { error?: string; draft?: Draft };
      if (!response.ok) { if(response.status<500)pending.current = null; throw new Error(data.error || '投稿処理を保存できませんでした。'); }
      if(!data.draft?.id||!Number.isSafeInteger(data.draft.version))throw new Error('保存結果を確認できません。編集内容を保持しています。同じ内容で再試行してください。');
      pending.current = null;
      if (data.draft) {
        const savedDraft = normalizeDraft(data.draft);
        dirtyIds.current.delete(selectedDraft.id); dirtyIds.current.delete(savedDraft.id);
        setDrafts((current) => current.map((item) => item.id === selectedDraft.id ? savedDraft : item));
        setSelectedDraftId(savedDraft.id);
      }
      if(action!=='save-draft' && data.draft?.syncStatus!=='synced'){setPreview(false);throw new Error('送信結果の確認が必要です。Postizの投稿一覧で状態を確認してください。');}
      setNotice(action === 'postiz-draft' ? 'Postizの下書き保存を受け付けました。' : action === 'schedule' ? '予約を受け付けました。' : '下書きを保存しました。');
      setPreview(false); if (action !== 'save-draft') await loadRemote();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '投稿処理を確認できませんでした。'); }
    finally { setSaving(false); }
  };

  async function cancelReservation(){if(!selectedDraft||saving)return;setSaving(true);setError('');try{const r=await fetch('/api/marketing/postiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel-reservation',requestId:crypto.randomUUID(),draftId:selectedDraft.id,expectedVersion:selectedDraft.version,confirmed:true})}),data=await r.json();if(!r.ok)throw new Error(data.error);setDrafts(current=>current.map(d=>d.id===selectedDraft.id?normalizeDraft(data.draft):d));setCancelPreview(false);setNotice('予約を取り消し、Postizの下書きに戻ったことを確認しました。');}catch(e){setError(e instanceof Error?e.message:'取消結果を確認できません。');}finally{setSaving(false);}}
  function copyDraft(){if(!selectedDraft)return;const copy={...selectedDraft,id:'draft-'+crypto.randomUUID(),version:0,remotePostIds:[],syncStatus:'local' as const,syncMode:undefined,reviewState:'editing' as const,reviewNote:undefined,history:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};setDrafts(d=>[copy,...d]);setSelectedDraftId(copy.id);setPreview(false);setNotice('変更用の下書きを作成しました。日時と内容を確認して保存してください。');}
  async function review(state:'pending'|'changes'|'rejected'){
    if(!selectedDraft||dirty||saving)return;setSaving(true);setError('');try{const response=await fetch('/api/marketing/postiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review',requestId:crypto.randomUUID(),draftId:selectedDraft.id,expectedVersion:selectedDraft.version,state,note:reviewNote})});const data=await response.json();if(!response.ok)throw new Error(data.error);setDrafts(current=>current.map(d=>d.id===selectedDraft.id?normalizeDraft(data.draft):d));setNotice(state==='pending'?'確認待ちにしました。':'判断を保存しました。');setReviewNote('');}catch(e){setError(e instanceof Error?e.message:'保存できません。');}finally{setSaving(false);}
  }
  const fetchAnalytics = async (post: RemotePost) => {
    setSelectedPost(post); setAnalytics(null); setAnalyticsLoading(true); setError('');
    try {
      const response = await fetch(`/api/marketing/postiz?action=analytics&postId=${encodeURIComponent(post.id)}&days=30`, { cache: 'no-store' });
      const data = (await response.json()) as { analytics?: Analytics; error?: string };
      if (!response.ok) throw new Error(data.error || '分析値を取得できませんでした。');
      setAnalytics(Array.isArray(data.analytics) ? data.analytics : null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '分析値を取得できませんでした。'); }
    finally { setAnalyticsLoading(false); }
  };

  const previewText = useMemo(() => selectedDraft?.content || '本文が未入力です。', [selectedDraft?.content]);
  const postRows=useMemo(()=>{
    const local=drafts.map(d=>({key:'draft:'+d.id,id:d.id,type:'draft' as const,title:d.title||'無題の下書き',content:d.content,platform:d.platform??'x',status:d.reviewState==='pending'?'確認待ち':d.reviewState==='changes'?'差し戻し':d.reviewState==='rejected'?'却下':syncLabels[d.syncStatus]??'下書き',date:d.scheduleAt??d.updatedAt,url:null as string|null,post:null as RemotePost|null}));
    const remote=snapshot.posts.map(p=>({key:'post:'+p.id,id:p.id,type:'post' as const,title:(p.content||'公開済みの投稿').slice(0,60),content:p.content,platform:p.integration.providerIdentifier,status:statusLabel[p.state.toLowerCase()]||'状態を確認中',date:p.publishDate,url:safeUrl(p.releaseURL),post:p}));
    return [...local,...remote].filter(row=>(listPlatform==='all'||row.platform===listPlatform)&&(listStatus==='all'||listStatus==='draft'&&row.type==='draft'||listStatus==='published'&&row.type==='post'&&row.status==='公開済み'||listStatus==='scheduled'&&row.status==='予約済み'||listStatus==='attention'&&['失敗','送信失敗','結果の確認が必要','差し戻し','却下'].includes(row.status))&&(!listQuery.trim()||(row.title+' '+row.content).toLocaleLowerCase('ja').includes(listQuery.trim().toLocaleLowerCase('ja')))).sort((a,b)=>(b.date??'').localeCompare(a.date??''));
  },[drafts,snapshot.posts,listPlatform,listStatus,listQuery]);
  return <section className="ao-posts" aria-labelledby="posts-heading">
    <div className="ao-posts-head"><div><div className="ao-eyebrow">投稿を管理する</div><h3 id="posts-heading">投稿一覧・作成</h3><p className="ao-small">保存した下書き、予約済み投稿、公開済み投稿を一つの一覧で確認できます。</p></div><button type="button" onClick={()=>createDraft()} disabled={saving}>＋ 投稿を作成</button></div>
    <div className="ao-sns-platforms" aria-label="利用するSNS">{SNS_PLATFORMS.map(platform=>{
      const accounts=snapshot.accounts.filter(a=>(platform.identifiers as readonly string[]).includes(a.identifier));
      const active=accounts.filter(a=>!a.disabled).length;
      return <article key={platform.id}><h4>{platform.name}</h4><p>{loading?'確認中':remoteFailure?'接続を確認できません':!snapshot.configured?'Postiz未接続':active?`${active}アカウント接続済み`:accounts.length?'再接続が必要':'アカウント未接続'}</p><small>{platform.note}</small></article>;
    })}</div>
    {!snapshot.configured && !remoteFailure && <div className="ao-posts-setup" role="status"><strong>投稿サービスは未接続です。</strong><p>{loading ? '接続設定を確認しています…' : '接続後に、登録済みアカウントと投稿履歴を表示します。本文はサーバーの下書きとして編集できます。'}</p><details><summary>接続設定の説明</summary><p>管理者が環境設定でPostizの接続先と認証情報を設定します。画面やチャットへキーを入力しないでください。</p><dl><dt>接続先</dt><dd><code>POSTIZ_API_URL</code></dd><dt>認証情報</dt><dd><code>POSTIZ_API_KEY</code></dd></dl></details><a href={POSTIZ_SIGNUP_URL} target="_blank" rel="noreferrer">利用中のPostizを開く（外部）</a></div>}
    {error && <div className="ao-posts-error" role="alert">{error}</div>}
    {notice && <div className="ao-posts-notice" role="status">{notice}</div>}
    <section className="post-list" aria-labelledby="post-list-heading"><div className="ao-sectionhead"><div><h4 id="post-list-heading">投稿一覧</h4><span className="ao-small">{postRows.length}件</span></div><button type="button" onClick={()=>void loadRemote()} disabled={loading}>{loading?'更新中…':'一覧を更新'}</button></div><div className="post-list-filters"><label>投稿を検索<input type="search" value={listQuery} onChange={e=>setListQuery(e.target.value)} aria-describedby="post-search-help"/></label><small id="post-search-help">タイトルと本文から検索します。</small><label>SNS<select value={listPlatform} onChange={e=>setListPlatform(e.target.value)}><option value="all">すべて</option>{SNS_PLATFORMS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>状態<select value={listStatus} onChange={e=>setListStatus(e.target.value)}><option value="all">すべて</option><option value="draft">下書き・確認中</option><option value="scheduled">予約済み</option><option value="published">公開済み</option><option value="attention">確認が必要</option></select></label></div>{postRows.length?<div className="mp-table post-list-table"><table><thead><tr><th>投稿</th><th>SNS</th><th>状態</th><th>更新・公開日時</th><th>操作</th></tr></thead><tbody>{postRows.map(row=><tr key={row.key}><th><strong>{row.title}</strong><small>{row.content||'本文なし'}</small></th><td>{snsPlatform(row.platform)?.name??row.platform}</td><td>{row.status}</td><td>{dateLabel(row.date)}</td><td>{row.type==='draft'?<button type="button" onClick={()=>{setSelectedDraftId(row.id);setPreview(false);document.getElementById('post-editor')?.scrollIntoView({behavior:'smooth',block:'start'});}}>編集</button>:<><button type="button" onClick={()=>row.post&&void fetchAnalytics(row.post)}>分析を見る</button>{row.url&&<a href={row.url} target="_blank" rel="noreferrer">投稿を開く</a>}</>}</td></tr>)}</tbody></table></div>:<div className="mp-empty"><h4>該当する投稿はありません</h4><p>検索条件を変えるか、新しい投稿を作成してください。</p></div>}</section>
    <DraftCharts drafts={drafts}/>
    <PostCalendar drafts={drafts} posts={snapshot.posts} onSelect={id=>{setSelectedDraftId(id);setPreview(false);}} onDate={date=>createDraft(date)} onRemote={post=>void fetchAnalytics(post)}/>
    <div className="ao-actions"><button type="button" aria-pressed={draftFilter==='all'} onClick={()=>setDraftFilter('all')}>すべての下書き</button><button type="button" aria-pressed={draftFilter==='pending'} onClick={()=>setDraftFilter('pending')}>確認待ち {drafts.filter(d=>d.reviewState==='pending').length}件</button><button type="button" aria-pressed={draftFilter==='issues'} onClick={()=>setDraftFilter('issues')}>失敗・結果確認中</button></div>
    <div className="ao-posts-grid" id="post-editor"><div className="ao-posts-editor">
      <div className="ao-sectionhead"><h4>この端末の下書き</h4><span className="ao-small">{drafts.length}件</span></div>
      <div className="ao-posts-drafts" aria-label="下書き一覧">{drafts.filter(d=>draftFilter==='all'||(draftFilter==='pending'?d.reviewState==='pending':['failed','unknown','submitting'].includes(d.syncStatus))).map((draft) => <button type="button" key={draft.id} disabled={saving} aria-pressed={draft.id === selectedDraft?.id} onClick={() => { setSelectedDraftId(draft.id); setPreview(false); }}><strong>{draft.title || '無題の下書き'}</strong><span>{goalTitle(draft.goalId)} · {draft.reviewState==='pending'?'確認待ち':draft.reviewState==='changes'?'差し戻し':draft.reviewState==='rejected'?'却下':syncLabels[draft.syncStatus]} · {dateLabel(draft.updatedAt)}</span></button>)}</div>
      {selectedDraft?.syncStatus==='synced'&&<div className="ao-note">{selectedDraft.syncMode==='schedule'?<><p>日時や内容を変更するときは、先に現在の予約を取り消してください。</p><button type="button" disabled={saving} onClick={()=>setCancelPreview(true)}>予約の取消内容を確認</button></>:<><p>Postizの下書きとして保存されています。</p><button type="button" disabled={saving} onClick={copyDraft}>変更して予約する下書きを作る</button></>}</div>}
      {cancelPreview&&selectedDraft?.syncMode==='schedule'&&<div className="ao-note"><h4>この予約を取り消しますか</h4><p>{selectedDraft.title} / {dateLabel(selectedDraft.scheduleAt)}</p><p>Postizで下書きへ戻し、公開予約が止まったことを確認します。</p><button type="button" disabled={saving} onClick={()=>void cancelReservation()}>この予約を取り消す</button><button type="button" disabled={saving} onClick={()=>setCancelPreview(false)}>戻る</button></div>}
      {selectedDraft && <form onSubmit={(event) => { event.preventDefault(); void perform('save-draft'); }}><fieldset disabled={saving||!editable}><label>投稿先SNS<select value={selectedDraft.platform??'x'} onChange={e=>updateDraft({platform:e.target.value,accountId:'',options:{}})}>{SNS_PLATFORMS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>下書き名・動画タイトル<input value={selectedDraft.title} onChange={(event) => updateDraft({ title: event.target.value })} maxLength={100} /></label><label>本文<textarea value={selectedDraft.content} onChange={(event) => updateDraft({ content: event.target.value })} maxLength={4000} rows={9} placeholder="投稿本文を入力してください" /></label><MediaPicker ids={selectedDraft.assetIds??[]} thumbnailId={selectedDraft.options?.thumbnailId} onChange={assetIds=>updateDraft({assetIds})} onThumbnail={selectedDraft.platform==='youtube'?thumbnailId=>updateDraft({options:{...selectedDraft.options,thumbnailId}}):undefined} disabled={saving||!editable} onAssets={setAssets}/>
      {selectedDraft.platform?.startsWith('instagram')&&<label>投稿形式<select value={selectedDraft.options?.format??''} onChange={e=>updateDraft({options:{...selectedDraft.options,format:e.target.value as 'post'|'reel'}})}><option value="">選択してください</option><option value="post">画像・複数画像</option><option value="reel">リール</option></select></label>}
      {selectedDraft.platform==='youtube'&&<><label>動画の種類<select value={selectedDraft.options?.format??'video'} onChange={e=>updateDraft({options:{...selectedDraft.options,format:e.target.value as 'video'|'short'}})}><option value="video">通常動画</option><option value="short">Shorts向け（最終分類はYouTubeが判断）</option></select></label><label>公開範囲<select value={selectedDraft.options?.visibility??''} onChange={e=>updateDraft({options:{...selectedDraft.options,visibility:e.target.value as 'public'|'unlisted'|'private'}})}><option value="">選択してください</option><option value="public">公開</option><option value="unlisted">限定公開</option><option value="private">非公開</option></select></label><label>子ども向けの動画ですか<select value={selectedDraft.options?.kids??''} onChange={e=>updateDraft({options:{...selectedDraft.options,kids:e.target.value as 'yes'|'no'}})}><option value="">選択してください</option><option value="yes">はい</option><option value="no">いいえ</option></select></label></>}
      <label>関連する目標<select value={selectedDraft.goalId} onChange={(event) => updateDraft({ goalId: event.target.value })}>{goalOptions.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><label>接続済みアカウント<select value={selectedDraft.accountId} onChange={(event) => updateDraft({ accountId: event.target.value })} disabled={!snapshot.configured}><option value="">{snapshot.configured ? 'アカウントを選択' : '接続設定後に選択できます'}</option>{snapshot.accounts.filter(a=>a.identifier===selectedDraft.platform||(selectedDraft.platform==='instagram'&&a.identifier==='instagram-standalone')).map((account) => <option key={account.id} value={account.id} disabled={!isSelectableAccount(account)}>{account.name} / {snsPlatform(account.identifier)?.name??account.identifier}{!isSelectableAccount(account) ? account.disabled?'（再接続が必要）':'（画像・動画の投稿は未実装）' : ''}</option>)}</select></label><label>予約日時（任意）<input type="datetime-local" value={selectedDraft.scheduledAt} onChange={(event) => updateDraft({ scheduledAt: event.target.value })} /><span className="ao-small">端末の時間帯：{Intl.DateTimeFormat().resolvedOptions().timeZone}</span></label><div className="ao-posts-actions"><button type="submit" disabled={saving}>{saving ? '保存しています…' : '下書きを保存'}</button><button type="button" onClick={() => setPreview(true)} disabled={saving || dirty || !editable || !selectedDraft.content.trim()}>投稿前に確認</button></div><div className="ao-note"><h4>確認・差し戻し</h4>{selectedDraft.reviewNote&&<p>前回の判断：{selectedDraft.reviewNote}</p>}<label>確認メモ<textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} maxLength={2000}/></label><div className="ao-actions"><button type="button" disabled={dirty||saving} onClick={()=>void review('pending')}>確認待ちにする</button><button type="button" disabled={dirty||saving||!reviewNote.trim()} onClick={()=>void review('changes')}>差し戻す</button><button type="button" disabled={dirty||saving||!reviewNote.trim()} onClick={()=>void review('rejected')}>却下する</button></div></div></fieldset></form>}
      </div><aside className="ao-posts-remote"><div className="ao-sectionhead"><div><h4>Postizの投稿</h4><span className="ao-small">取得期間：{postsPeriod}</span></div><button type="button" onClick={() => void loadRemote()} disabled={loading}>更新</button></div>{snapshot.configured ? <>{snapshot.posts.length ? <div className="ao-posts-remote-list">{snapshot.posts.map((post) => <div className="ao-posts-remote-item" key={post.id}><button type="button" onClick={() => void fetchAnalytics(post)}><strong>{statusLabel[post.state.toLowerCase()] || '状態を確認中'}</strong><span>{post.integration.providerIdentifier} / {post.integration.name}</span><span>{dateLabel(post.publishDate)}</span><small>{post.content}</small></button>{safeUrl(post.releaseURL) && <a href={safeUrl(post.releaseURL)!} target="_blank" rel="noreferrer">投稿を開く</a>}</div>)}</div> : <p className="ao-small">指定期間内の投稿はありません。</p>}{selectedPost && <div className="ao-posts-analytics"><h4>選択した投稿の分析</h4>{!analyticsLoading&&analytics&&<SelectableChart onSelect={(id,key)=>showAnalytics(key,analytics?.find(s=>s.label===key)?.data[Number(id)]?.date)} title="投稿指標の推移" kind="line" series={analytics.map(s=>({id:s.label,label:metricLabels[s.label.toLowerCase()]??s.label,unit:'',points:s.data.map((d,i)=>({id:String(i),label:d.date,date:d.date,value:numericValue(d.total)}))}))} note="取得元が返した日付・単位の数値です。未取得日の補完はしません。"/>}<p>{selectedPost.integration.providerIdentifier} / {selectedPost.integration.name}</p>{analyticsLoading ? <p className="ao-small">分析値を取得しています…</p> : analytics?.length ? <dl>{analytics.map((series) => <div key={series.label}><dt>{metricLabels[series.label.toLowerCase()]??'その他の指標'}</dt><dd><DetailValue label={metricLabels[series.label.toLowerCase()]??series.label} onClick={()=>showAnalytics(series.label)}>{series.data.at(-1)?.total ?? '未取得'}</DetailValue><small> · {series.data.at(-1)?.date??'観測日未取得'}</small></dd></div>)}</dl> : <p className="ao-small">利用できる分析値はありません。</p>}</div>}</> : remoteFailure ? <p className="ao-small">投稿一覧を取得できませんでした。接続状態を確認して再試行してください。</p> : <p className="ao-small">接続設定後に、状態・日時・投稿URLを表示します。</p>}</aside></div>
    {preview && selectedDraft && <section className="ao-posts-preview" aria-labelledby="posts-preview-heading"><div className="ao-posts-preview-card"><h4 id="posts-preview-heading">投稿前の確認</h4><dl><dt>タイトル</dt><dd>{selectedDraft.title}</dd><dt>本文</dt><dd>{previewText}</dd><dt>素材と順序</dt><dd><div className="ao-media-grid">{(selectedDraft.assetIds??[]).map(id=>{const asset=assets.find(a=>a.id===id);return asset?<div key={id}><MediaPreview asset={asset}/>{asset.name}</div>:<p key={id}>素材が見つかりません</p>;})}</div>{selectedDraft.options?.thumbnailId&&<p>表紙：{assets.find(a=>a.id===selectedDraft.options?.thumbnailId)?.name??'見つかりません'}</p>}</dd><dt>公開設定</dt><dd>{selectedDraft.platform==='youtube'?`${({public:'公開',unlisted:'限定公開',private:'非公開'} as Record<string,string>)[selectedDraft.options?.visibility??'']??'未選択'} / 子ども向け：${selectedDraft.options?.kids==='yes'?'はい':selectedDraft.options?.kids==='no'?'いいえ':'未選択'}`:selectedDraft.options?.format==='reel'?'リール':'通常投稿'}</dd><dt>宛先</dt><dd>{selectedAccount ? `${selectedAccount.identifier} / ${selectedAccount.name}` : '未選択'}</dd><dt>予約日時</dt><dd>{selectedDraft.scheduledAt ? `${dateLabel(selectedDraft.scheduledAt)}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）` : '指定なし（予約は実行できません）'}</dd></dl><p>予約すると、指定した時刻にSNSへ実際に投稿されます。</p><p className="ao-small">内容を編集した場合は、戻ってからもう一度この確認を開いてください。</p><div className="ao-posts-actions"><button type="button" onClick={() => setPreview(false)} disabled={saving}>戻って編集</button><button type="button" className="ao-primary" onClick={() => void perform('postiz-draft')} disabled={saving || dirty || !editable || !snapshot.configured || !selectedAccount}>{saving ? '保存しています…' : 'Postizに下書き保存'}</button><button type="button" className="ao-primary" onClick={() => void perform('schedule')} disabled={saving || dirty || !editable || !snapshot.configured || !selectedAccount || !selectedDraft.scheduledAt}>{saving ? '予約しています…' : 'この日時で予約'}</button></div></div></section>}
    {selectedDraft && <div className="ao-posts-savebar"><span className="ao-small">{dirty?'未保存の編集があります':`保存済み · ${syncLabels[selectedDraft.syncStatus]}`} · {dateLabel(selectedDraft.updatedAt)}</span><button type="button" onClick={() => void perform('save-draft')} disabled={saving||!editable}>下書きを保存</button></div>}
  {detail.drawer}</section>;
}
