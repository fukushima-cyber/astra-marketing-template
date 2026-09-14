'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useIdentity} from '../company/session';
import {can,type AccessPage} from '@/lib/access';
import BusinessContext,{useBusiness} from './business-context';
import ConnectedDashboard from './connected-dashboard';
import AnalyticsPanel from './analytics-panel';
import BusinessPanel from './business-panel';
import ConnectionsPanel from './connections-panel';
import PostsPanel from './posts-panel';
import ReadOnlyPanel from './read-only-panel';
import OkrPanel from './okr-panel';
import ExecutionPanel from './execution-panel';
import './planning.css';
import ImprovementsPanel from './improvements-panel';
import AutonomyPanel from './autonomy-panel';
import AdsPanel from './ads-panel';
import SummaryDashboard from './summary-dashboard';
const pages={'improvement-settings':{name:'診断・下書きの範囲',access:'improvements'},settings:{name:'設定',access:'business'},'autonomy-settings':{name:'Astra・モデル',access:'autonomy'},'ads-settings':{name:'広告の接続・上限',access:'ads'},autonomy:{name:'Astraに任せる',access:'autonomy'},ads:{name:'広告運用',access:'ads'},improvements:{name:'改善・診断',access:'improvements'},dashboard:{name:'総合ダッシュボード',access:'analytics'},overview:{name:'SNS・LPの数字',access:'overview'},analytics:{name:'実績の比較・分析',access:'analytics'},okr:{name:'目標のつながり（OKR）',access:'okr'},work:{name:'実行管理',access:'work'},posts:{name:'SNS投稿',access:'posts'},funnels:{name:'案件・ファネル',access:'business'},'goal-settings':{name:'目標の設定',access:'business'},observations:{name:'観測データ',access:'business'},import:{name:'実績の取込',access:'analytics'},connections:{name:'データ接続',access:'connections'}} as const;
type Panel=keyof typeof pages;
const settingPanels:Panel[]=['funnels','goal-settings','observations','connections','autonomy-settings','ads-settings','improvement-settings'];
const groups:[string,Panel[]][]=[['数字を見る',['dashboard','overview','analytics']],['目標と実行',['autonomy','okr','improvements','work','posts','ads']],['管理する',['import','settings']]];
const aliases:Record<string,Panel>={business:'funnels',goals:'okr',journey:'funnels',knowledge:'okr'};
function MarketingWorkspace(){
 const user=useIdentity(),business=useBusiness(),heading=useRef<HTMLHeadingElement>(null),dirty=useRef(false),[notice,setNotice]=useState('');
 const allowed=useCallback((p:string):p is Panel=>Object.hasOwn(pages,p)&&(p==='settings'?settingPanels.some(k=>can(user,business.id,pages[k].access as AccessPage)):(can(user,business.id,pages[p as Panel].access as AccessPage,p==='import')||(['okr','work'].includes(p)&&can(user,business.id,'business')))),[user,business.id]);
 function read(){const url=new URL(location.href),raw=aliases[url.searchParams.get('panel')??'']??url.searchParams.get('panel')??'dashboard',wanted=raw==='settings'?(settingPanels.find(k=>k===url.searchParams.get('section')&&allowed(k))??settingPanels.find(allowed)??'dashboard'):raw;return{panel:allowed(wanted)?wanted:(Object.keys(pages).find(k=>k!=='settings'&&allowed(k))??'overview') as Panel,goal:url.searchParams.get('goal')??''};}
 const [route,setRoute]=useState(read),panel=route.panel;
 useEffect(()=>{if(settingPanels.includes(panel)){const u=new URL(location.href);u.searchParams.set('panel','settings');u.searchParams.set('section',panel);history.replaceState(null,'',u);}},[panel]);
 useEffect(()=>{const guard=(e:Event)=>{if(dirty.current&&!confirm('未保存の変更があります。破棄して事業を切り替えますか？'))e.preventDefault();};window.addEventListener('astra-business-change',guard);return()=>window.removeEventListener('astra-business-change',guard);},[]);
 const onDirtyChange=useCallback((value:boolean)=>{dirty.current=value;},[]);
 useEffect(()=>{const pop=()=>{if(dirty.current&&!confirm('未保存の変更があります。破棄して画面を切り替えますか？')){const url=new URL(location.href);url.searchParams.set('panel',route.panel);history.pushState(null,'',url);return;}dirty.current=false;if(new URL(location.href).searchParams.get('businessId')&&new URL(location.href).searchParams.get('businessId')!==business.id){location.reload();return;}setRoute(read());};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[route,allowed]);
 function navigate(next:Panel,goal=''){
 if(next==='settings')next=settingPanels.find(allowed)??'dashboard';
 if(!allowed(next)){setNotice('この画面の閲覧・操作権限がありません。全体管理者に確認してください。');return;}
 if(dirty.current&&!confirm('未保存の変更があります。破棄して画面を切り替えますか？'))return;
 dirty.current=false;setNotice('');const url=new URL(location.href);url.searchParams.set('panel',settingPanels.includes(next)?'settings':next);if(settingPanels.includes(next))url.searchParams.set('section',next);else url.searchParams.delete('section');if(goal)url.searchParams.set('goal',goal);else url.searchParams.delete('goal');history.pushState(null,'',url);setRoute({panel:next,goal});setTimeout(()=>heading.current?.focus(),0);
 }
 const editable=can(user,business.id,pages[panel].access as AccessPage,true);
 return <div id="astra-okr" aria-label="Astra マーケティング管理"><label className="mp-mobile-nav">画面を切り替える<select value={settingPanels.includes(panel)?'settings':panel} onChange={e=>navigate(e.target.value as Panel)}>{groups.map(([name,items])=><optgroup key={name} label={name}>{items.filter(allowed).map(key=><option key={key} value={key}>{pages[key].name}</option>)}</optgroup>)}</select></label><div className="ao-shell"><aside className="ao-side"><div className="mp-brand">Astra<small>マーケティング</small></div><nav className="ao-nav mp-navigation" aria-label="主要画面">{groups.map(([name,items])=>{const visible=items.filter(allowed);return visible.length?<section key={name}><h2>{name}</h2>{visible.map(key=><button key={key} aria-current={(panel===key||key==='settings'&&settingPanels.includes(panel))?'page':undefined} onClick={()=>navigate(key)}>{pages[key].name}</button>)}</section>:null;})}</nav><a className="mp-back" href="/company">← 会社ホームへ</a></aside>
 <main className="ao-main"><header className="mp-pagehead"><div className="ao-breadcrumb">{business.name} / {settingPanels.includes(panel)?'設定':groups.find(([,items])=>items.includes(panel))?.[0]}</div><h2 ref={heading} tabIndex={-1}>{settingPanels.includes(panel)?'設定':pages[panel].name}</h2></header>{settingPanels.includes(panel)&&<><p className="mp-muted">この事業の設定をまとめて管理します。</p><nav className="mp-settings-tabs" aria-label="設定の項目">{settingPanels.filter(allowed).map(k=><button key={k} aria-current={panel===k?'page':undefined} onClick={()=>navigate(k)}>{pages[k].name}</button>)}</nav></>}{notice&&<p role="status" className="ao-note">{notice}</p>}
 <div key={panel}>
 {panel==='dashboard'&&<SummaryDashboard onAnalysis={funnel=>{const u=new URL(location.href);for(const k of ['projectId','sourceType','platform','funnelId'])u.searchParams.delete(k);if(funnel)u.searchParams.set('funnelId',funnel);history.replaceState(null,'',u);navigate('analytics');}} onOkr={()=>{const u=new URL(location.href);u.searchParams.set('okrView','funnels');history.replaceState(null,'',u);navigate('okr');}} onWork={()=>navigate('work')} onNative={()=>navigate('overview')}/>}
 {panel==='overview'&&<ConnectedDashboard onAdvanced={()=>navigate('analytics')} onSettings={()=>navigate('connections')}/>}
 {panel==='analytics'&&<AnalyticsPanel onSettings={()=>navigate('funnels')} onDiscuss={()=>navigate('work')} onImport={()=>navigate('import')}/>}
 {panel==='import'&&<AnalyticsPanel importOnly onSettings={()=>navigate('funnels')} onDiscuss={()=>navigate('work')} onImport={()=>navigate('import')}/>}
 {panel==='okr'&&<OkrPanel onFunnels={()=>navigate('funnels')} onSettings={()=>navigate('goal-settings')} onObservation={()=>navigate('observations')} onWork={goal=>navigate('work',goal)}/>}
 {panel==='autonomy'&&<AutonomyPanel onDirtyChange={onDirtyChange} onAds={()=>navigate('ads-settings')} onSettings={()=>navigate('autonomy-settings')}/>}
 {panel==='ads'&&<AdsPanel onDirtyChange={onDirtyChange} onImprovement={()=>navigate('improvements')} onSettings={()=>navigate('ads-settings')}/>}
 {panel==='improvements'&&<ImprovementsPanel onDirtyChange={onDirtyChange} onWork={()=>navigate('work')} onPosts={()=>navigate('posts')} onSettings={()=>navigate('improvement-settings')}/>}
 {panel==='work'&&<ExecutionPanel goalId={route.goal} onOkr={()=>navigate('okr')} onSettings={()=>navigate('goal-settings')} onDirtyChange={onDirtyChange}/>}
 {panel==='posts'&&(editable?<PostsPanel goalId=""/>:<ReadOnlyPanel page="posts"/>)}
 {(['funnels','goal-settings','observations'] as string[]).includes(panel)&&(editable?<BusinessPanel section={panel==='funnels'?'funnels':panel==='goal-settings'?'settings':'observations'} onDirtyChange={onDirtyChange} onDiscuss={()=>navigate('work')}/>:<ReadOnlyPanel page="business" section={panel}/>)}
 {panel==='autonomy-settings'&&<AutonomyPanel settingsOnly onDirtyChange={onDirtyChange} onAds={()=>navigate('ads-settings')}/>}
 {panel==='improvement-settings'&&<ImprovementsPanel settingsOnly onDirtyChange={onDirtyChange} onWork={()=>navigate('work')} onPosts={()=>navigate('posts')}/>}
 {panel==='ads-settings'&&<AdsPanel settingsOnly onDirtyChange={onDirtyChange} onImprovement={()=>navigate('improvements')}/>}
 {panel==='connections'&&(editable?<ConnectionsPanel onDirtyChange={onDirtyChange} onOverview={()=>navigate('overview')}/>:<ReadOnlyPanel page="connections"/>)}
 </div></main></div></div>;
}
export default function BusinessWorkspace(){return <BusinessContext><MarketingWorkspace/></BusinessContext>;}
