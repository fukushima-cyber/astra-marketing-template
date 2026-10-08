'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import type {Identity} from '@/lib/access';
import {businessSwitchUrl,type BusinessSummary} from '@/lib/business';
const Context=createContext<Identity|null>(null);
const HeaderActionsContext=createContext<HTMLDivElement|null>(null);
export function useHeaderActions(){return useContext(HeaderActionsContext);}
const BusinessesContext=createContext<BusinessSummary[]|null>(null);
export function useIdentity(){const value=useContext(Context);if(!value)throw new Error('ログインを確認してください。');return value;}
export function useSessionBusinesses(){return useContext(BusinessesContext);}
export default function Session({children}:{children:React.ReactNode}){
 const pathname=usePathname();
 const [headerActions,setHeaderActions]=useState<HTMLDivElement|null>(null);
 const bootstrapped=useRef(false);
 const [user,setUser]=useState<Identity|null>(null),[businesses,setBusinesses]=useState<BusinessSummary[]|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[search,setSearch]=useState('');
 useEffect(()=>{let alive=true,inFlight=false,timer:ReturnType<typeof setTimeout>;async function load(){if(inFlight)return;inFlight=true;clearTimeout(timer);try{const r=await fetch('/api/me'+(bootstrapped.current?'':'?include=businesses'),{cache:'no-store',signal:AbortSignal.timeout(12000)});if(r.status===401){location.replace('/login');return;}const b=await r.json();if(!r.ok)throw new Error(b.error);if(alive){setUser(b.user);if(Array.isArray(b.businesses)){setBusinesses(b.businesses);bootstrapped.current=true;}setError('');}}catch{if(alive){setError('ログイン状態を確認できません。接続を確認して再試行してください。');}}finally{inFlight=false;if(alive)timer=setTimeout(load,30000);}}void load();const focus=()=>{clearTimeout(timer);void load();};window.addEventListener('focus',focus);return()=>{alive=false;clearTimeout(timer);window.removeEventListener('focus',focus);};},[attempt]);
 useEffect(()=>{const sync=()=>setSearch(location.search);sync();window.addEventListener('popstate',sync);window.addEventListener('astra-location-change',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('astra-location-change',sync);};},[pathname]);
 useEffect(()=>{const sync=(e:Event)=>setBusinesses((e as CustomEvent<BusinessSummary[]>).detail.filter(b=>!b.archivedAt));window.addEventListener('astra-businesses-updated',sync);return()=>window.removeEventListener('astra-businesses-updated',sync);},[]);
 if(!user)return <main className="co-loading"><h1>会社ダッシュボード</h1><p role="status">{error||'ログインを確認しています…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>再試行</button>}</main>;
 const current=(href:string)=>href==='/company'?pathname==='/company'||pathname==='/':pathname.startsWith(href);
 const businessId=new URLSearchParams(search).get('businessId')??'',selected=businesses?.find(b=>b.id===businessId);

 function switchBusiness(id:string){if(!window.dispatchEvent(new Event('astra-business-change',{cancelable:true})))return;location.assign(businessSwitchUrl(new URL(location.href),id));}
 return <Context.Provider value={user}><BusinessesContext.Provider value={businesses}><HeaderActionsContext.Provider value={headerActions}><header className="co-global"><a className="co-brand" href="/company">会社ダッシュボード</a><nav aria-label="会社の主要画面"><a href="/company" aria-current={current('/company')?'page':undefined}>会社ホーム</a><a href="/marketing" aria-current={current('/marketing')?'page':undefined}>事業一覧</a>{user.role==='owner'&&<a href="/owner" aria-current={current('/owner')?'page':undefined}>全体管理</a>}</nav><div className="co-business-tools"><label className="co-business-select"><span>事業を切り替え</span><select aria-label="事業を切り替え" value={selected?.id??''} onChange={e=>switchBusiness(e.target.value)}><option value="">すべての事業</option>{businesses?.filter(b=>!b.archivedAt).map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><div className="co-header-actions" ref={setHeaderActions}/></div>{error&&<span role="status" className="co-session-warning">接続を再確認しています。編集内容は保持されています。</span>}<span className="co-user">{user.name}<small>{user.role==='owner'?'全体管理者':'メンバー'}</small></span><form className="co-logout" method="post" action="/logout"><button>ログアウト</button></form></header>{children}</HeaderActionsContext.Provider></BusinessesContext.Provider></Context.Provider>;
}
