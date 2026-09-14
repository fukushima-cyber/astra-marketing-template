'use client';
import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {useIdentity} from '../company/session';
import {can,type AccessPage} from '@/lib/access';
export function usePageAccess(page:AccessPage,edit=false){const user=useIdentity(),business=useBusiness();return can(user,business.id,page,edit);}
type Business={id:string;name:string};
const Context=createContext<{id:string;name:string}>({id:'default',name:'既存の事業'});
export function useBusiness(){return useContext(Context);}
export function useBusinessFetch(){const {id}=useBusiness();return useMemo(()=>((input:RequestInfo|URL,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('X-Astra-Business',id);return globalThis.fetch(input,{...init,headers});}) as typeof fetch,[id]);}
export default function BusinessContext({children}:{children:React.ReactNode}){
 const user=useIdentity();
 const [list,setList]=useState<Business[]>([]),[id,setId]=useState(''),[error,setError]=useState(''),[editing,setEditing]=useState<'create'|'rename'|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/marketing/businesses',{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error);setList(b.businesses);return b.businesses as Business[];}
 useEffect(()=>{let live=true;load().then(rows=>{if(live){const saved=new URLSearchParams(location.search).get('businessId')??localStorage.getItem('astra-business');setId(rows.find(b=>b.id===saved)?.id??rows[0]?.id??'');}}).catch(e=>setError(e.message));return()=>{live=false;};},[]);
 function choose(value:string){if(!window.dispatchEvent(new Event('astra-business-change',{cancelable:true})))return;setId(value);localStorage.setItem('astra-business',value);setEditing(null);const url=new URL(location.href);url.searchParams.set('businessId',value);for(const key of ['projectId','funnelId','goal'])url.searchParams.delete(key);history.replaceState(null,'',url);}
 async function save(){setBusy(true);setError('');try{const selectedId=editing==='create'?crypto.randomUUID():id;const r=await fetch('/api/marketing/businesses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:editing,id:selectedId,name})}),b=await r.json();if(!r.ok)throw new Error(b.error);await load();choose(selectedId);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const selected=list.find(b=>b.id===id);
 return <><div className="business-switcher"><strong>Astra</strong><label>事業<select aria-label="事業を切り替える" value={id} disabled={busy} onChange={e=>choose(e.target.value)}>{list.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{user.role==='owner'&&<button disabled={busy} onClick={()=>{setEditing('create');setName('');}}>＋ 事業を追加</button>}{selected&&user.role==='owner'&&<button disabled={busy} onClick={()=>{setEditing('rename');setName(selected.name);}}>名前を変更</button>}{editing&&<form onSubmit={e=>{e.preventDefault();void save();}}><input aria-label="事業名" value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="事業名" autoFocus/><button disabled={busy||!name.trim()}>保存</button><button type="button" onClick={()=>setEditing(null)}>閉じる</button></form>}{error&&<span role="alert">{error}</span>}</div>{selected?<Context.Provider value={selected}><div key={id}>{children}</div></Context.Provider>:<p className="business-loading">{error?'事業一覧を取得できませんでした。画面を再読み込みしてください。':list.length===0?'閲覧できる事業がありません。全体管理者に権限を確認してください。':'事業を読み込み中…'}</p>}</>;
}
