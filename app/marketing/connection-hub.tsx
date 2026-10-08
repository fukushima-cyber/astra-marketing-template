'use client';
import dynamic from 'next/dynamic';
import {useBusiness} from './business-context';
import {useIdentity} from '../company/session';
import {can} from '@/lib/access';
import {availableConnectionTabs} from '@/lib/workspace-navigation';
import './connected.css';
import './connection-hub.css';
const Loading=()=> <p role="status">接続を確認中…</p>;
const Native=dynamic(()=>import('./connections-panel'),{loading:Loading});
const Ads=dynamic(()=>import('./ad-reporting-panel'),{loading:Loading});
const Meta=dynamic(()=>import('./ads-panel'),{loading:Loading});
const Measurement=dynamic(()=>import('./measurement-panel'),{loading:Loading});
const ReadOnly=dynamic(()=>import('./read-only-panel'),{loading:Loading});
export default function ConnectionHub({section,provider,onSelect,onDirtyChange,onOverview,onSources,onImprovement}:{section:string;provider:string;onSelect:(section:string)=>void;onDirtyChange:(dirty:boolean)=>void;onOverview:()=>void;onSources:()=>void;onImprovement:()=>void}){
 const business=useBusiness(),user=useIdentity(),tabs=availableConnectionTabs(user,business.id,business.acquisitionChannels??[]),selected=tabs.find(t=>t.id===section)??tabs[0];
 if(!selected)return <p>閲覧できる接続はありません</p>;
 return <section className="connection-hub"><nav className="connection-hub-nav" aria-label="接続の種類">{tabs.map(t=><button key={t.id} aria-current={selected.id===t.id?'page':undefined} onClick={()=>onSelect(t.id)}>{t.name}</button>)}</nav><div className="connection-hub-content" key={selected.id}>
 {selected.id==='ads'&&<Ads settingsOnly setupProvider={provider==='meta'?'meta':'google'} onDirtyChange={onDirtyChange}/>}
 {selected.id==='meta'&&<Meta settingsOnly onDirtyChange={onDirtyChange} onImprovement={onImprovement}/>}
 {selected.id==='measurement'&&<Measurement settingsOnly onDirtyChange={onDirtyChange} onSources={can(user,business.id,'analytics')?onSources:undefined}/>}
 {(selected.id==='sns'||selected.id==='utage')&&(can(user,business.id,'connections',true)?<Native channel={selected.id==='sns'?'sns':'email'} onDirtyChange={onDirtyChange} onOverview={onOverview}/>:<ReadOnly page="connections" section={selected.id}/>)}
 </div></section>;
}
