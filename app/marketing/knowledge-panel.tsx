'use client';
import {useEffect,useState} from 'react';
import {usePageAccess} from './business-context';
import AgentSkills from './agent-skills';
import ImprovementsPanel from './improvements-panel';
export default function KnowledgePanel({onDirtyChange,onWork,onPosts,onSettings}:{onDirtyChange:(v:boolean)=>void;onWork:()=>void;onPosts:()=>void;onSettings:()=>void}){
 const documents=usePageAccess('improvements'),skills=usePageAccess('autonomy'),[tab,setTab]=useState(()=>skills&&new URLSearchParams(location.search).get('knowledgeView')==='skills'?'skills':documents?'documents':'skills'),[dirty,setDirty]=useState(false);
 useEffect(()=>{onDirtyChange(dirty);const guard=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault();};window.addEventListener('beforeunload',guard);return()=>{onDirtyChange(false);window.removeEventListener('beforeunload',guard);};},[dirty,onDirtyChange]);
 function choose(next:string){if(tab===next)return;if(dirty&&!confirm('未保存の内容を破棄して表示を切り替えますか？'))return;setDirty(false);setTab(next);const url=new URL(location.href);url.searchParams.set('knowledgeView',next);history.replaceState(null,'',url);}
 return <section><div className="mp-tabs"><button disabled={!documents} aria-pressed={tab==='documents'} onClick={()=>choose('documents')}>資料と振り返り</button><button disabled={!skills} aria-pressed={tab==='skills'} onClick={()=>choose('skills')}>既存スキル</button></div>{tab==='documents'&&documents&&<ImprovementsPanel knowledgeOnly onDirtyChange={setDirty} onWork={onWork} onPosts={onPosts} onSettings={onSettings}/>} {tab==='skills'&&skills&&<AgentSkills onDirtyChange={setDirty}/>}<p className="mp-muted">資料とスキルは、それぞれの事業と閲覧権限に従って表示します。スキルの登録で自動運用は開始しません。</p></section>;
}
