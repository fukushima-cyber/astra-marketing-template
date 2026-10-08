'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {PanelLeft,Home,ChartNoAxesCombined,Users,Wallet,History,BookOpen,Activity,Search,Megaphone,Link,Mail,Share2,MousePointer2,Globe,Target,GitBranch,ListChecks,ClipboardList,FilePenLine,Bot,Presentation,Upload,Plug,Settings,ShieldCheck,ArrowLeft,type LucideIcon} from 'lucide-react';
import {useIdentity} from '../company/session';
import {can,type AccessPage} from '@/lib/access';
import {workspacePages,groupsForChannels,channelAnalysisPanels,settingPanels,canOpenPanel,readWorkspaceRoute,workspaceUrl,type WorkspacePanel as Panel} from '@/lib/workspace-navigation';
import {handoffKey,parseHandoff,safeAnalysisPath,type AnalysisHandoff} from '@/lib/analysis-handoff';
import BusinessContext,{useBusiness} from './business-context';
import './planning.css';
import './ad-reporting.css';
const CommercePanel=dynamic(()=>import('./commerce-panel'));
const JourneyPanel=dynamic(()=>import('./journey-panel'));
const HistoryPanel=dynamic(()=>import('./history-panel'));
const PanelLoading=()=> <p role="status" className="business-loading">画面を読み込み中…</p>;
const ConnectedDashboard=dynamic(()=>import('./connected-dashboard'),{loading:PanelLoading});
const AnalyticsPanel=dynamic(()=>import('./analytics-panel'),{loading:PanelLoading});
const BusinessPanel=dynamic(()=>import('./business-panel'),{loading:PanelLoading});
const ConnectionHub=dynamic(()=>import('./connection-hub'),{loading:PanelLoading});
const PostsPanel=dynamic(()=>import('./posts-panel'),{loading:PanelLoading});
const ReadOnlyPanel=dynamic(()=>import('./read-only-panel'),{loading:PanelLoading});
const OkrPanel=dynamic(()=>import('./okr-panel'),{loading:PanelLoading});
const ExecutionPanel=dynamic(()=>import('./execution-panel'),{loading:PanelLoading});
const ImprovementsPanel=dynamic(()=>import('./improvements-panel'),{loading:PanelLoading});
const AutonomyPanel=dynamic(()=>import('./autonomy-panel'),{loading:PanelLoading});
const AdReportingPanel=dynamic(()=>import('./ad-reporting-panel'),{loading:PanelLoading});
const AdsPanel=dynamic(()=>import('./ads-panel'),{loading:PanelLoading});
const KnowledgePanel=dynamic(()=>import('./knowledge-panel'),{loading:PanelLoading});
const SummaryDashboard=dynamic(()=>import('./summary-dashboard'),{loading:PanelLoading});
const TasksPanel=dynamic(()=>import('./tasks-panel'),{loading:PanelLoading});
const CategoryDashboard=dynamic(()=>import('./category-dashboard'),{loading:PanelLoading});
const WhiteboardPanel=dynamic(()=>import('./whiteboard-panel'),{loading:PanelLoading});
const pages=workspacePages;
const panelIcons:Record<Panel,LucideIcon>={
 dashboard:Home,analytics:ChartNoAxesCombined,'journey-events':Users,commerce:Wallet,history:History,knowledge:BookOpen,measurement:Activity,overview:Activity,
 'seo-analysis':Search,'ads-analysis':Megaphone,'ads-connections':Plug,'sns-connections':Plug,'email-connections':Plug,'sns-analysis':Share2,'email-analysis':Mail,'referral-analysis':Link,'direct-analysis':MousePointer2,'other-analysis':Globe,
 improvements:Target,okr:Target,funnels:GitBranch,'goal-settings':Target,observations:Activity,work:ClipboardList,tasks:ListChecks,posts:FilePenLine,ads:Megaphone,autonomy:Bot,whiteboard:Presentation,import:Upload,connections:Plug,settings:Settings,'autonomy-settings':Bot,'ads-settings':ShieldCheck,'improvement-settings':Settings,
};
function MarketingWorkspace(){
 const user=useIdentity(),business=useBusiness(),heading=useRef<HTMLHeadingElement>(null),dirty=useRef(false),[notice,setNotice]=useState('');
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('astra-sidebar-collapsed')==='true';}catch{return false;}});
 const sidebarToggle=useRef<HTMLButtonElement>(null),reopenToggle=useRef<HTMLButtonElement>(null);
 function toggleSidebar(){const next=!collapsed;setCollapsed(next);try{localStorage.setItem('astra-sidebar-collapsed',String(next));}catch{}setTimeout(()=>(next?reopenToggle:sidebarToggle).current?.focus(),0);}
 const transfers=useRef(new Map<string,AnalysisHandoff>());
 const channels=business.acquisitionChannels??[];
 const groups=groupsForChannels(channels);
 const channelKey=channels.join(',');
 const allowed=useCallback((p:string)=>canOpenPanel(user,business.id,p,channels),[user,business.id,channelKey]);
 const read=()=>({...readWorkspaceRoute(new URL(location.href),allowed),href:location.href});
 const [route,setRoute]=useState(read);
 const panel=route.panel&&allowed(route.panel)?route.panel:null;
 useEffect(()=>{
  const next=readWorkspaceRoute(new URL(location.href),allowed);
  const url=new URL(location.href),raw=url.searchParams.get('panel');
  const requested=raw==='settings'?url.searchParams.get('section'):raw;
  if(next.panel&&requested&&Object.hasOwn(pages,requested)&&!allowed(requested)){
   dirty.current=false;const fallback=workspaceUrl(url,next.panel);history.replaceState(null,'',fallback);
   window.dispatchEvent(new Event('astra-location-change'));
   setNotice('選択中のチャネルと閲覧権限に応じて、表示できる画面に切り替えました。保存済みのデータは残っています。');
  }
  setRoute({...next,href:location.href});
 },[allowed]);
 const onDirtyChange=useCallback((value:boolean)=>{dirty.current=value;},[]);
 useEffect(()=>{
  const guard=(e:Event)=>{if(dirty.current&&!confirm('未保存の変更があります。破棄して事業を切り替えますか？'))e.preventDefault();};
  const linkGuard=(e:MouseEvent)=>{const a=(e.target as Element)?.closest?.('a');if(!a||e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||a.target==='_blank')return;if(dirty.current&&!confirm('未保存の変更があります。破棄して画面を移動しますか？')){e.preventDefault();e.stopPropagation();}};
  window.addEventListener('astra-business-change',guard);document.addEventListener('click',linkGuard,true);
  return()=>{window.removeEventListener('astra-business-change',guard);document.removeEventListener('click',linkGuard,true);};
 },[]);
 useEffect(()=>{const pop=()=>{
  if(dirty.current&&!confirm('未保存の変更があります。破棄して画面を切り替えますか？')){history.pushState(null,'',route.href);window.dispatchEvent(new Event('astra-location-change'));return;}
  dirty.current=false;
  const query=new URL(location.href).searchParams;
  if(query.get('businessId')!==business.id){location.reload();return;}
  setRoute(read());
 };window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[route,allowed,business.id]);
 function navigate(next:Panel,params:Record<string,string|undefined>={}){
  if(next==='settings')next=settingPanels.find(allowed)??'dashboard';
  if(!allowed(next)){setNotice('この画面は現在のチャネル設定または閲覧権限では開けません。事業設定と権限を確認してください。');return false;}
  if(dirty.current&&!confirm('未保存の変更があります。破棄して画面を切り替えますか？'))return false;
  dirty.current=false;setNotice('');const url=workspaceUrl(new URL(location.href),next,params);
  history.pushState(null,'',url);window.dispatchEvent(new Event('astra-location-change'));setRoute(read());setTimeout(()=>heading.current?.focus(),0);return true;
 }
 function discuss(input:AnalysisHandoff|string){
  const transfer:AnalysisHandoff=typeof input==='string'?{id:crypto.randomUUID(),businessId:business.id,title:'目標の改善を検討',source:input.slice(0,1800),comparison:'基準と今回の観測条件を確認する。',returnPath:'/marketing?businessId='+encodeURIComponent(business.id)+'&panel=analytics',createdAt:new Date().toISOString()}:input;
  if(transfer.businessId!==business.id)return;
  if(!navigate('work',{handoff:transfer.id}))return;
  transfers.current.set(transfer.id,transfer);
  try{sessionStorage.setItem(handoffKey(business.id,transfer.id),JSON.stringify(transfer));}catch{/* The current tab can still use the in-memory handoff. */}
 }
 let handoff=transfers.current.get(route.handoff)??null;
 if(!handoff&&route.handoff){try{handoff=parseHandoff(sessionStorage.getItem(handoffKey(business.id,route.handoff)),business.id,route.handoff);}catch{/* Storage may be disabled. */}}
 if(!panel)return <section className="mp-empty"><h2>この事業で閲覧できる画面がありません</h2><p>全体管理者に閲覧範囲を確認してください。</p><a href="/company">会社ホームへ</a></section>;
 const editable=can(user,business.id,pages[panel].access as AccessPage,true);
 const group=groups.find(g=>g.panels.includes(panel));
 const onWork=(goal='')=>navigate('work',{goal});
 return <div id="astra-okr" aria-label="マーケティング管理"><label className="mp-mobile-nav"><span>表示する画面</span><select aria-label="表示する画面" value={panel} onChange={e=>navigate(e.target.value as Panel)}>{groups.map(g=><optgroup key={g.name} label={g.name}>{g.panels.filter(allowed).map(key=><option key={key} value={key}>{pages[key].name}</option>)}</optgroup>)}</select></label>
 <div className={'ao-shell'+(collapsed?' sidebar-collapsed':'')}><aside id="workspace-sidebar" className="ao-side" hidden={collapsed}>
 <div className="mp-sidebar-head"><strong title={business.name}>{business.name}</strong><button ref={sidebarToggle} className="mp-side-toggle" aria-expanded={true} aria-controls="workspace-sidebar" aria-label="サイドバーを閉じる" title="サイドバーを閉じる" onClick={toggleSidebar}><PanelLeft size={18} aria-hidden="true"/></button></div>
 <nav className="ao-nav mp-navigation" aria-label="主要画面">{groups.map(g=>{const visible=g.panels.filter(allowed);return visible.length?<section key={g.name} aria-label={g.name}>{visible.map(key=>{const Icon=panelIcons[key];return <button key={key} aria-current={(panel===key)?'page':undefined} onClick={()=>navigate(key)}><Icon size={18} strokeWidth={1.7} aria-hidden="true"/><span>{pages[key].name}</span></button>;})}</section>:null;})}</nav><a className="mp-back" href="/company"><ArrowLeft size={16} aria-hidden="true"/><span>会社ホームへ</span></a></aside>
 <main className="ao-main"><header className="mp-pagehead">{collapsed&&<button ref={reopenToggle} className="mp-side-toggle" aria-expanded={false} aria-controls="workspace-sidebar" aria-label="サイドバーを開く" title="サイドバーを開く" onClick={toggleSidebar}><PanelLeft size={18} aria-hidden="true"/></button>}<div className="mp-title-context"><div className="ao-breadcrumb">{business.name} / {group?.name}</div><h2 ref={heading} tabIndex={-1}>{pages[panel].name}</h2><p className="mp-muted">{group?.description}</p></div></header>

 {!channels.length&&<p className="ao-note">集客チャネルは未設定です。事業設定で選ぶと、対応する機能がサイドバーに表示されます。過去の実績は「実績の比較・分析」で確認できます。</p>}
 {notice&&<p role="status" className="ao-note">{notice}</p>}
 <div key={panel+':'+route.href}>
 {panel==='commerce'&&<CommercePanel onDirtyChange={onDirtyChange}/>}
 {panel==='journey-events'&&<JourneyPanel onDirtyChange={onDirtyChange}/>}
 {panel==='history'&&<HistoryPanel/>}
 {panel==='dashboard'&&<SummaryDashboard onCommerce={allowed('commerce')?()=>navigate('commerce'):undefined} onJourney={()=>navigate('journey-events')} onTasks={allowed('tasks')?campaign=>navigate('tasks',{campaign}):undefined} onGoalSettings={allowed('goal-settings')?()=>navigate('goal-settings'):undefined} onMeasurement={()=>navigate('measurement')} onAds={()=>navigate('ads-analysis')} onAnalysis={funnel=>navigate('analytics',{projectId:undefined,sourceType:undefined,platform:undefined,funnelId:funnel})} onOkr={()=>navigate('okr',{okrView:'funnels'})} onWork={campaign=>navigate('work',{campaign})} onNative={()=>navigate('overview')}/>}
 {panel==='overview'&&<ConnectedDashboard onAdvanced={()=>navigate('analytics')} onSettings={()=>navigate('connections')}/>}
 {(panel==='analytics'||(channelAnalysisPanels[panel]&&panel!=='ads-analysis'))&&<AnalyticsPanel channel={channelAnalysisPanels[panel]} onSettings={()=>navigate('funnels')} onDiscuss={discuss} canCreateCampaign={can(user,business.id,'work',true)||can(user,business.id,'business',true)} onImport={()=>navigate('import')}/>}
 {panel==='import'&&<AnalyticsPanel importOnly onDirtyChange={onDirtyChange} onSettings={()=>navigate('funnels')} onDiscuss={discuss} onImport={()=>navigate('import')}/>}
 {panel==='okr'&&<OkrPanel onFunnels={()=>navigate('funnels')} onSettings={()=>navigate('goal-settings')} onObservation={()=>navigate('observations')} onWork={onWork}/>}
 {panel==='autonomy'&&<AutonomyPanel onCase={allowed('improvements')?id=>navigate('improvements',{campaign:id}):undefined} onKnowledge={allowed('improvements')?()=>navigate('knowledge'):undefined} onDirtyChange={onDirtyChange} onAds={allowed('ads-settings')?()=>navigate('ads-settings'):undefined} onSettings={()=>navigate('autonomy-settings')}/>}
 {panel==='ads-analysis'&&<AdReportingPanel key={panel} setupProvider={new URL(route.href).searchParams.get('provider')==='meta'?'meta':'google'} settingsOnly={false} onSettings={provider=>navigate('ads-connections',{provider})} onDirtyChange={onDirtyChange}/>}
 {panel==='ads'&&<AdsPanel onDirtyChange={onDirtyChange} onImprovement={()=>navigate('improvements')} onSettings={()=>navigate('ads-settings')}/>}
 {panel==='knowledge'&&<KnowledgePanel onDirtyChange={onDirtyChange} onWork={()=>onWork()} onPosts={()=>navigate('posts')} onSettings={()=>navigate('improvement-settings')}/>}
 {panel==='improvements'&&<ImprovementsPanel initialCaseId={route.campaign} knowledgeOnly={new URL(route.href,'https://astra.local').searchParams.get('section')==='knowledge'} onDirtyChange={onDirtyChange} onWork={()=>onWork()} onPosts={()=>navigate('posts')} onSettings={()=>navigate('improvement-settings')}/>}
 {panel==='tasks'&&<TasksPanel campaignId={route.campaign} onDirtyChange={onDirtyChange} onWork={campaign=>navigate('work',{campaign})}/>}
 {panel==='whiteboard'&&<WhiteboardPanel onDirtyChange={onDirtyChange}/>}
 {panel==='work'&&<ExecutionPanel onAutonomy={()=>navigate('autonomy')} goalId={route.goal} campaignId={route.campaign} handoff={handoff} handoffMissing={!!route.handoff&&!handoff} onSaved={id=>{dirty.current=false;transfers.current.delete(route.handoff);try{sessionStorage.removeItem(handoffKey(business.id,route.handoff));}catch{}history.replaceState(null,'',workspaceUrl(new URL(location.href),'work',{campaign:id}));window.dispatchEvent(new Event('astra-location-change'));setRoute(read());}} onTasks={campaign=>navigate('tasks',{campaign})} onAnalysis={path=>{const safe=safeAnalysisPath(path,business.id);if(safe){const query=new URL(safe,location.origin).searchParams;navigate('analytics',{start:undefined,end:undefined,projectId:undefined,funnelId:undefined,sourceType:undefined,platform:undefined,q:undefined,analysisView:undefined,axis:undefined,column:undefined,metric:undefined,...Object.fromEntries(query)});}}} onOkr={()=>navigate('okr')} onSettings={()=>navigate('goal-settings')} onDirtyChange={onDirtyChange}/>}
 {panel==='posts'&&(editable?<PostsPanel goalId="" onDirtyChange={onDirtyChange}/>:<ReadOnlyPanel page="posts"/>)}
 {(['funnels','goal-settings','observations'] as string[]).includes(panel)&&(editable?<BusinessPanel section={panel==='funnels'?'funnels':panel==='goal-settings'?'settings':'observations'} onDirtyChange={onDirtyChange} onDiscuss={discuss}/>:<ReadOnlyPanel page="business" section={panel}/>)}
 {panel==='autonomy-settings'&&<AutonomyPanel settingsOnly onDirtyChange={onDirtyChange} onAds={allowed('ads-settings')?()=>navigate('ads-settings'):undefined} onSettings={()=>navigate('autonomy-settings')}/>}
 {panel==='improvement-settings'&&<ImprovementsPanel settingsOnly onDirtyChange={onDirtyChange} onWork={()=>onWork()} onPosts={()=>navigate('posts')} onSettings={()=>navigate('improvement-settings')}/>}
 {panel==='connections'&&<ConnectionHub section={route.connectionTab} provider={new URL(route.href).searchParams.get('provider')??''} onSelect={connectionTab=>navigate('connections',{connectionTab,provider:undefined})} onDirtyChange={onDirtyChange} onOverview={()=>navigate('overview')} onSources={()=>navigate('journey-events')} onImprovement={()=>navigate('improvements')}/>}
 </div></main></div></div>;
}
function CategoryWorkspace(){return <div id="astra-okr" aria-label="事業一覧"><main className="ao-main"><header className="mp-pagehead"><h2>事業一覧</h2><p>上部から事業を選ぶと、その事業の目標、ファネル、施策を開けます。</p></header><CategoryDashboard/></main></div>;}
function WorkspaceRouter(){const business=useBusiness();return business.aggregate?<CategoryWorkspace/>:<MarketingWorkspace key={business.id}/>;}
export default function BusinessWorkspace(){return <BusinessContext><WorkspaceRouter/></BusinessContext>;}
