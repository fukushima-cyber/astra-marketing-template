import {pageStatements} from './native-pages.ts';
import {digest} from './storage.ts';
import type {Env,Statement} from './types.ts';
import {normalizePages,n,sum,windowDates,type Page} from '../lib/connected/model.ts';
export type Target={id:string;name:string};
export type Connection={id:string;business_id:string;provider:string;label:string;external_id:string;credential:string;targets:string;enabled:number;last_attempt:string|null;last_success:string|null;last_error:string|null};
const providers=['x','threads','instagram','utage','youtube'];
const instagramMetrics=['views','reach','profile_views','total_interactions','accounts_engaged'] as const;
const encode=(v:Uint8Array)=>btoa(String.fromCharCode(...v));
const decode=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
export async function seal(env:Env,scope:string,id:string,value:string,open=false){
 if(!env.CONNECTOR_KEY)throw new Error('接続情報の保存を準備中です。');
 const key=await crypto.subtle.importKey('raw',decode(env.CONNECTOR_KEY),'AES-GCM',false,['encrypt','decrypt']);
 const aad=new TextEncoder().encode(JSON.stringify([scope,id]));
 if(open){const [iv,data]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:aad},key,decode(data)));}
 const iv=crypto.getRandomValues(new Uint8Array(12));return encode(iv)+'.'+encode(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(value))));
}
async function api(url:string,token:string):Promise<any>{
 let r;try{r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new Error('取得先に接続できませんでした。時間を置いて再取得してください。');}
 if(!r.ok)throw new Error(r.status===401||r.status===403?'接続キーの有効期限・読取権限を確認してください。':r.status===429?'取得先の利用上限に達しました。時間を置いて再取得してください。':'取得先がエラーを返しました。');
 return r.json();
}
export async function funnelList(token:string):Promise<Target[]>{
 const rows:Target[]=[];
 for(let page=1;page<=20;page++){
 const raw=await api(`https://api.utage-system.com/v1/funnels?page=${page}&per_page=100`,token);
 if(!Array.isArray(raw.data))throw new Error('ファネル一覧の形式を確認してください。');
 for(const f of raw.data){if(typeof f.id!=='string'||!/^[-a-zA-Z0-9]+$/.test(f.id))throw new Error('ファネル情報の形式を確認してください。');rows.push({id:f.id,name:typeof f.name==='string'?f.name:f.id});}
 if(raw.meta?.total!==undefined?rows.length>=Number(raw.meta.total):raw.data.length<100)return rows;
 }
 throw new Error('ファネルが多すぎて一覧を取得しきれませんでした。');
}
export async function profile(provider:string,token:string){
 if(provider==='utage'){await funnelList(token);return{id:'workspace-'+await digest(token),name:'UTAGE',followers:null};}
 if(provider==='x'){const r=await api('https://api.x.com/2/users/me?user.fields=public_metrics',token);if(!r.data?.id)throw new Error('アカウントを取得できませんでした。');return{id:String(r.data.id),name:String(r.data.username),followers:n(r.data.public_metrics?.followers_count)};}
 if(provider==='threads'){const me=await api('https://graph.threads.net/v1.0/me?fields=id,username',token);if(!me.id)throw new Error('アカウントを取得できませんでした。');const stats=await api('https://graph.threads.net/v1.0/me/threads_insights?metric=followers_count',token);return{id:String(me.id),name:String(me.username),followers:n(stats.data?.find((d:any)=>d.name==='followers_count')?.total_value?.value)};}
 if(provider==='instagram'){const r=await api('https://graph.instagram.com/v25.0/me?fields=user_id,username,name,account_type,followers_count,media_count',token),id=r.user_id??r.id;if(!id||!r.username)throw new Error('Instagramのプロアカウントを取得できませんでした。');return{id:String(id),name:String(r.username),followers:n(r.followers_count),mediaCount:n(r.media_count)};}
 if(provider==='youtube'){const r=await api('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',token),c=r.items?.[0];if(!c?.id)throw new Error('チャンネルを取得できませんでした。');return{id:String(c.id),name:String(c.snippet?.title??c.id),followers:c.statistics?.hiddenSubscriberCount?null:n(c.statistics?.subscriberCount==null?null:Number(c.statistics.subscriberCount))};}
 throw new Error('この媒体の数字取得は準備中です。');
}
function insightValue(raw:any,name:string){const row=raw?.data?.find((item:any)=>item?.name===name),value=row?.total_value?.value??row?.values?.at?.(-1)?.value;return n(typeof value==='string'?Number(value):value);}
export async function instagramSnapshot(token:string){
 const p=await profile('instagram',token),values:Record<string,number|null>={},failures:Error[]=[];
 for(const metric of instagramMetrics){try{const raw=await api(`https://graph.instagram.com/v25.0/${encodeURIComponent(p.id)}/insights?${new URLSearchParams({metric,metric_type:'total_value',period:'day'})}`,token);values[metric]=insightValue(raw,metric);}catch(e){values[metric]=null;failures.push(e instanceof Error?e:new Error('Instagramの指標を取得できませんでした。'));}}
 if(failures.length===instagramMetrics.length)throw failures[0];
 return{id:p.id,handle:p.name,followers:p.followers,mediaCount:p.mediaCount??null,impressions:values.views,reach:values.reach,profileViews:values.profile_views,interactions:values.total_interactions,engagedAccounts:values.accounts_engaged};
}
export async function pagesFor(env:Env,c:Connection,target:string,start:string,end:string):Promise<Page[]>{
 if(c.provider!=='utage'||!JSON.parse(c.targets).some((t:Target)=>t.id===target))throw new Error('この事業で選択したファネルではありません。');
 const token=await seal(env,c.business_id,c.id,c.credential,true);
 return normalizePages(await api(`https://api.utage-system.com/v1/funnels/${encodeURIComponent(target)}/stats/daily?${new URLSearchParams({date_from:start,date_to:end,aggregation_method:'accrual_date'})}`,token),target,start,end);
}
export async function listConnections(env:Env,scope:string){return(await env.DB.prepare('SELECT * FROM native_connections WHERE business_id=? ORDER BY created_at,id').bind(scope).all<Connection>()).results;}
export async function collect(env:Env,c:Connection){
 const now=new Date().toISOString(),pending:Statement[]=[];
 await env.DB.prepare('UPDATE native_connections SET last_attempt=? WHERE id=? AND business_id=?').bind(now,c.id,c.business_id).run();
 try{
 const put=(resource:string,day:string,data:unknown)=>env.DB.prepare('INSERT INTO native_snapshots(business_id,connection_id,resource_id,day,data,collected_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM native_connections WHERE id=? AND business_id=? AND credential=? AND enabled=1) ON CONFLICT(connection_id,resource_id,day) DO UPDATE SET data=excluded.data,collected_at=excluded.collected_at WHERE excluded.collected_at>=native_snapshots.collected_at').bind(c.business_id,c.id,resource,day,JSON.stringify(data),now,c.id,c.business_id,c.credential);
 if(c.provider==='utage'){
 const targets=JSON.parse(c.targets) as Target[];if(!targets.length)throw new Error('取得するファネルを選んでください。');
 const range=windowDates(3);
 for(const t of targets){const pages=await pagesFor(env,c,t.id,range.start,range.end);const days=[...new Set(pages.flatMap(p=>p.daily.map(d=>d.date)))];
 pending.push(...pageStatements(env,c,t.id,range.start,range.end,pages,now));
 for(const day of days){const values=pages.map(p=>p.daily.find(d=>d.date===day));pending.push(put(t.id,day,{pv:values.some(d=>d?.pv==null)?null:sum(values.map(d=>d?.pv??null)).value,uu:null,registrationCount:values.some(d=>d?.registrations==null)?null:sum(values.map(d=>d?.registrations??null)).value}));}}
 }else{const token=await seal(env,c.business_id,c.id,c.credential,true),day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);if(c.provider==='instagram'){const p=await instagramSnapshot(token);if(p.id!==c.external_id)throw new Error('登録したアカウントと接続キーが一致しません。');pending.push(put('account',day,p));}else{const p=await profile(c.provider,token);if(p.id!==c.external_id)throw new Error('登録したアカウントと接続キーが一致しません。');pending.push(put('account',day,{followers:p.followers,impressions:null,handle:p.name}));}}
 const results=await env.DB.batch([...pending,env.DB.prepare('UPDATE native_connections SET last_success=?,last_error=NULL WHERE id=? AND business_id=? AND credential=? AND enabled=1 AND (last_success IS NULL OR last_success<=?)').bind(now,c.id,c.business_id,c.credential,now)]);if(!(results.at(-1) as {meta:{changes:number}})?.meta.changes)throw new Error('接続設定が変更されました。最新の設定で再取得してください。');
 }catch(e){const message=e instanceof Error?e.message:'取得できませんでした。';await env.DB.prepare('UPDATE native_connections SET last_error=? WHERE id=? AND business_id=? AND credential=? AND (last_success IS NULL OR last_success<=?)').bind(message,c.id,c.business_id,c.credential,now).run();throw new Error(message);}
}
export async function scheduled(env:Env){
 // Bound each invocation: at most 2 connections × 10 UTAGE requests, or 6 Instagram requests.
 const cutoff=new Date(Date.now()-3600000).toISOString(),daily=new Date(Date.now()-24*3600000).toISOString();
 const rows=await env.DB.prepare("SELECT n.* FROM native_connections n JOIN businesses b ON b.id=n.business_id WHERE b.archived_at IS NULL AND n.enabled=1 AND (n.last_attempt IS NULL OR n.last_attempt<?) AND (n.last_success IS NULL OR n.last_success<?) ORDER BY COALESCE(n.last_attempt,'') LIMIT 2").bind(cutoff,daily).all<Connection>();
 for(const c of rows.results){try{await collect(env,c);}catch{/* The connection screen shows the saved error. */}}
}
export async function connections(r:Request,env:Env,scope:string){
 const json=(b:unknown,status=200)=>Response.json(b,{status});
 if(r.method==='GET')return json({connections:(await listConnections(env,scope)).map(({credential,...c})=>({...c,targets:JSON.parse(c.targets)})),ready:!!env.CONNECTOR_KEY});
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 try{
 const text=await r.text();if(text.length>20000)return json({error:'入力が大きすぎます。'},413);const b=JSON.parse(text);
 if(b.action==='create'){
 if(!providers.includes(b.provider)||typeof b.token!=='string'||!b.token.trim()||b.token.length>10000||typeof b.label!=='string'||!b.label.trim()||b.label.length>100)return json({error:'媒体・名前・接続キーを確認してください。'},400);
 const existing=await listConnections(env,scope);if(existing.length>=30)return json({error:'1事業に登録できる接続は30件までです。'},400);
 const p=await profile(b.provider,b.token.trim());if(existing.some(c=>c.provider===b.provider&&c.external_id===p.id))return json({error:'登録済みです。既存の接続のキーを更新してください。'},409);
 const id=crypto.randomUUID(),credential=await seal(env,scope,id,b.token.trim());
 await env.DB.prepare('INSERT INTO native_connections(id,business_id,provider,label,external_id,credential,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,scope,b.provider,b.label.trim(),p.id,credential,new Date().toISOString()).run();
 return json({id});
 }
 const c=await env.DB.prepare('SELECT * FROM native_connections WHERE id=? AND business_id=?').bind(typeof b.id==='string'?b.id:'',scope).first<Connection>();if(!c)return json({error:'この事業に接続が見つかりません。'},404);
 if(b.action==='funnels'){if(c.provider!=='utage')return json({error:'UTAGEの接続を選んでください。'},400);return json({funnels:await funnelList(await seal(env,scope,c.id,c.credential,true))});}
 if(b.action==='targets'){
 if(c.provider!=='utage'||!Array.isArray(b.ids)||b.ids.length>10||b.ids.some((id:unknown)=>typeof id!=='string')||new Set(b.ids).size!==b.ids.length)return json({error:'ファネルを10件以内で選んでください。'},400);
 const all=await funnelList(await seal(env,scope,c.id,c.credential,true));if(b.ids.some((id:string)=>!all.some(t=>t.id===id)))return json({error:'一覧にないファネルです。'},400);
 await env.DB.prepare('UPDATE native_connections SET targets=?,last_success=NULL WHERE id=? AND business_id=?').bind(JSON.stringify(all.filter(t=>b.ids.includes(t.id))),c.id,scope).run();return json({ok:true});
 }
 if(b.action==='replace'){
 if(typeof b.token!=='string'||!b.token.trim()||b.token.length>10000)return json({error:'接続キーを確認してください。'},400);
 const p=await profile(c.provider,b.token.trim());const currentId=c.provider==='utage'? 'workspace-'+await digest(await seal(env,scope,c.id,c.credential,true)):c.external_id;if(p.id!==currentId)return json({error:'接続先が同じと確認できません。別のキーは新規接続として登録してください。UTAGEはキーを変更しても過去の履歴を引き継ぎません。'},400);
 const credential=await seal(env,scope,c.id,b.token.trim());await env.DB.prepare('UPDATE native_connections SET credential=?,last_error=NULL,last_success=NULL WHERE id=? AND business_id=?').bind(credential,c.id,scope).run();return json({ok:true});
 }
 if(b.action==='toggle'&&typeof b.enabled==='boolean'){await env.DB.prepare('UPDATE native_connections SET enabled=? WHERE id=? AND business_id=?').bind(b.enabled?1:0,c.id,scope).run();return json({ok:true});}
 if(b.action==='collect'){if(!c.enabled)return json({error:'収集を再開してから取得してください。'},400);if(c.last_attempt&&Date.now()-Date.parse(c.last_attempt)<60000)return json({error:'1分ほど待って再取得してください。'},429);await collect(env,c);return json({ok:true});}
 return json({error:'操作を確認してください。'},400);
 }catch(e){return json({error:e instanceof SyntaxError?'入力形式を確認してください。':e instanceof Error?e.message:'取得できませんでした。'},400);}
}
