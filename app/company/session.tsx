'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import type {Identity} from '@/lib/access';
const Context=createContext<Identity|null>(null);
export function useIdentity(){const value=useContext(Context);if(!value)throw new Error('ログインを確認してください。');return value;}
export default function Session({children}:{children:React.ReactNode}){
 const [user,setUser]=useState<Identity|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let alive=true,inFlight=false,timer:ReturnType<typeof setTimeout>;async function load(){if(inFlight)return;inFlight=true;clearTimeout(timer);try{const r=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(r.status===401){location.replace('/login');return;}const b=await r.json();if(!r.ok)throw new Error(b.error);if(alive){setUser(b.user);setError('');}}catch{if(alive){setUser(null);setError('ログイン状態を確認できません。接続を確認して再試行してください。');}}finally{inFlight=false;if(alive)timer=setTimeout(load,30000);}}void load();const focus=()=>{clearTimeout(timer);void load();};window.addEventListener('focus',focus);return()=>{alive=false;clearTimeout(timer);window.removeEventListener('focus',focus);};},[attempt]);
 if(!user)return <main className="co-loading"><h1>会社ダッシュボード</h1><p role="status">{error||'ログインを確認しています…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>再試行</button>}</main>;
 return <Context.Provider value={user}><header className="co-global"><a className="co-brand" href="/company">会社ダッシュボード</a><nav aria-label="会社の主要画面"><a href="/company">会社ホーム</a><a href="/marketing">マーケティング</a>{user.role==='owner'&&<a href="/owner">全体管理</a>}</nav><span>{user.name}<small>{user.role==='owner'?'全体管理者':'メンバー'}</small></span><form method="post" action="/logout"><button>ログアウト</button></form></header>{children}</Context.Provider>;
}
