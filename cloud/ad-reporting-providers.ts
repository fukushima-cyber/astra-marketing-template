import {adProviders,credentialFields,metricNumber as number,daysIn,dayAfter,type AdProvider,type AdReport} from '../lib/ads/reporting.ts';
import {validDate} from '../lib/analytics/model.ts';
export type Credentials=Record<string,string>;
export type RemoteAccount={id:string;name:string;currency:string;timezone:string};
export class ReportingError extends Error {}
const fail=(s='媒体の応答形式を確認できません。保存済みの実績は変更していません。'):never=>{throw new ReportingError(s);};
const list=(v:unknown):any[]=>Array.isArray(v)?v:fail();
const text=(v:unknown):string=>typeof v==='string'&&v.length>0&&v.length<=500?v:typeof v==='number'&&Number.isSafeInteger(v)?String(v):fail();
export function validateCredentials(provider:unknown,id:unknown,input:unknown):{provider:AdProvider;id:string;credentials:Credentials}{
 if(!adProviders.includes(provider as AdProvider)||typeof id!=='string'||!input||typeof input!=='object')fail('媒体と広告アカウントIDを確認してください。');
 const p=provider as AdProvider,account=id as string;
 const patterns:Record<AdProvider,RegExp>={google:/^\d{10}$/,line:/^[A-Za-z0-9]{1,40}$/,meta:/^act_\d+$/,x:/^[a-z0-9]{1,40}$/,tiktok:/^\d{1,30}$/,chatgpt:/^adacct_[A-Za-z0-9_-]{1,100}$/};
 if(!patterns[p].test(account))fail('広告アカウントIDの形式を確認してください。');
 const credentials:Credentials={};for(const f of credentialFields[p]){const v=(input as Credentials)[f.key];if((v===undefined||v==='')&&f.optional)continue;if(typeof v!=='string'||!v.trim()||v.length>10000)fail('認証項目をすべて入力してください。');credentials[f.key]=v.trim();}
 if(p==='google'&&credentials.loginCustomerId&&!/^\d{10}$/.test(credentials.loginCustomerId))fail('管理アカウントIDは10桁で入力してください。');
 return {provider:p,id:account,credentials};
}
function validateAccount(a:RemoteAccount,id:string){if(a.id!==id||!a.name||!/^[A-Z]{3}$/.test(a.currency))fail('アカウントIDまたは通貨を確認できません。');try{new Intl.DateTimeFormat('en',{timeZone:a.timezone}).format();}catch{fail('広告アカウントの時間帯を確認してください。');}return a;}
const enc=new TextEncoder();
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v));
const url64=(s:string)=>b64(enc.encode(s)).replace(/\+/g,'-').replace(/\//g,'_'); // LINE requires padding.
async function hmac(hash:string,key:string,value:string){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(value)));}
export async function lineAuthorization(c:Credentials,path:string,now=new Date()){
 const sha=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(''))),hex=Array.from(sha,x=>x.toString(16).padStart(2,'0')).join('');
 const input=url64(JSON.stringify({alg:'HS256',kid:c.accessKey,typ:'text/plain'}))+'.'+url64([hex,'',now.toISOString().slice(0,10).replaceAll('-',''),path].join('\n'));
 return 'Bearer '+input+'.'+b64(await hmac('SHA-256',c.secretKey,input)).replace(/\+/g,'-').replace(/\//g,'_');
}
const percent=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export async function xAuthorization(c:Credentials,url:URL,nonce=crypto.randomUUID(),timestamp=String(Math.floor(Date.now()/1000))){
 const oauth:Record<string,string>={oauth_consumer_key:c.consumerKey,oauth_nonce:nonce,oauth_signature_method:'HMAC-SHA1',oauth_timestamp:timestamp,oauth_token:c.accessToken,oauth_version:'1.0'};
 const parameters=[...url.searchParams.entries(),...Object.entries(oauth)].map(([k,v])=>[percent(k),percent(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(x=>x.join('=')).join('&');
 oauth.oauth_signature=b64(await hmac('SHA-1',percent(c.consumerSecret)+'&'+percent(c.accessTokenSecret),'GET&'+percent(url.origin+url.pathname)+'&'+percent(parameters)));
 return 'OAuth '+Object.entries(oauth).map(([k,v])=>percent(k)+'="'+percent(v)+'"').join(', ');
}
export function midnight(day:string,timezone:string){
 const target=Date.parse(day+'T00:00:00Z');let guess=target;
 for(let i=0;i<4;i++){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);if(local===target)return new Date(guess).toISOString();guess+=target-local;}return fail('時間帯の日付境界を確認できません。');
}
export function createReportingClient(provider:AdProvider,id:string,c:Credentials){
 let requests=0;const deadline=Date.now()+110000;let googleToken='';
 async function request(url:URL|string,init:RequestInit={}){
  if(++requests>38||Date.now()>deadline)fail('取得上限に達しました。期間を短くして再取得してください。');
  let response:Response;try{response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(Math.min(20000,Math.max(1,deadline-Date.now())))});}catch{fail('媒体との通信が完了しませんでした。時間を置いて再取得してください。');}
  if(!response!.ok){const status=response!.status;await response!.body?.cancel();fail(status===429?'媒体の取得上限に達しました。15分以上空けて再取得してください。':status===401||status===403?'認証または広告アカウントへの閲覧権限を確認してください。':`媒体APIが取得を受け付けませんでした（HTTP ${status}）。期間とAPI利用権限を確認してください。`);}
  let body:any;try{body=await response!.json();}catch{fail();}if(!body||typeof body!=='object')fail();if(body.error||body.errors)fail('媒体APIが取得を拒否しました。認証とアカウントの設定を確認してください。');return body;
 }
 async function get(path:string,params:Record<string,string>={},extra?:URLSearchParams){
  const roots:Record<AdProvider,string>={google:'https://googleads.googleapis.com/v25',line:'https://ads.line.me/api/v3',meta:'https://graph.facebook.com/v26.0',x:'https://ads-api.x.com/12',tiktok:'https://business-api.tiktok.com/open_api/v1.3',chatgpt:'https://api.ads.openai.com/v1'};
  const u=new URL(roots[provider]+path);u.search=extra?.toString()??new URLSearchParams(params).toString();let headers:Record<string,string>={};
  if(provider==='line'){const now=new Date();headers={Date:now.toUTCString(),Authorization:await lineAuthorization(c,u.pathname,now)};}
  else if(provider==='x')headers={Authorization:await xAuthorization(c,u)};
  else if(provider==='tiktok')headers={'Access-Token':c.token};else headers={Authorization:'Bearer '+c.token};
  const b=await request(u,{headers});if(provider==='tiktok'&&b.code!==0)fail('TikTokの認証、広告アカウントの認可、取得条件を確認してください。');return b;
 }
 async function google(query:string){
  if(!c.developerToken)fail('Google Ads開発者トークンが必要です。媒体API接続でキーを更新してください。');
  if(!googleToken){const b=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refreshToken})});if(typeof b.access_token!=='string'||!b.access_token||b.access_token.length>20000)fail();googleToken=b.access_token;}
  let cursor='';const rows:any[]=[],seen=new Set<string>();
  do {const b=await request(`https://googleads.googleapis.com/v25/customers/${id}/googleAds:search`,{method:'POST',headers:{Authorization:'Bearer '+googleToken,'developer-token':c.developerToken,'Content-Type':'application/json',...(c.loginCustomerId?{'login-customer-id':c.loginCustomerId}:{})},body:JSON.stringify({query,...(cursor?{pageToken:cursor}:{})})});rows.push(...list(b.results??[]));if(rows.length>10000)fail('取得件数が多すぎます。期間を短くしてください。');cursor=b.nextPageToken??'';if(cursor&&seen.has(cursor))fail();seen.add(cursor);}while(cursor);return rows;
 }
 async function account():Promise<RemoteAccount>{
  let a:RemoteAccount;
  if(provider==='google'){const r=(await google('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'))[0]?.customer;a={id:text(r?.id),name:r?.descriptiveName||id,currency:text(r?.currencyCode),timezone:text(r?.timeZone)};}
  else if(provider==='meta'){const r=await get('/'+id,{fields:'id,name,currency,timezone_name'});a={id:text(r.id),name:r.name||id,currency:text(r.currency),timezone:text(r.timezone_name)};}
  else if(provider==='chatgpt'){const r=await get('/ad_account');a={id:text(r.id),name:r.name||id,currency:text(r.currency_code),timezone:text(r.timezone)};}
  else if(provider==='line'){const r=await get('/adaccounts/'+id);a={id:text(r.id),name:r.name||id,currency:c.currency,timezone:c.timezone};}
  else if(provider==='tiktok'){const b=await get('/advertiser/info/',{advertiser_ids:JSON.stringify([id])}),r=list(b.data?.list).find(r=>String(r.advertiser_id)===id);a={id:text(r?.advertiser_id),name:r?.name||id,currency:text(r?.currency),timezone:text(r?.timezone)};}
  else{const r=(await get('/accounts/'+id)).data;let currency=r?.currency;if(!currency){const funds=await cursorPages('/accounts/'+id+'/funding_instruments',{count:'200',with_deleted:'true'}),currencies=[...new Set(funds.map(f=>text(f.currency)))];if(currencies.length!==1)fail('X広告の請求通貨を一意に確認できません。');currency=currencies[0];}a={id:text(r?.id),name:r?.name||id,currency:text(currency),timezone:text(r?.timezone)};}
  return validateAccount(a,id);
 }
 async function cursorPages(path:string,params:Record<string,string>,key='data'){
  const rows:any[]=[],seen=new Set<string>();let cursor='';do{const b=await get(path,{...params,...(cursor?{[provider==='meta'?'after':'cursor']:cursor}:{})});rows.push(...list(b[key]));const next=provider==='meta'?(b.paging?.next?b.paging?.cursors?.after:''):b.next_cursor;cursor=next?text(next):'';if(provider==='meta'&&b.paging?.next&&!cursor)fail();if(cursor&&seen.has(cursor))fail();seen.add(cursor);if(rows.length>10000)fail('取得件数が多すぎます。期間を短くしてください。');}while(cursor);return rows;
 }
 async function reports(a:RemoteAccount,start:string,end:string):Promise<AdReport[]>{
  const rows:AdReport[]=[];
  const add=(day:unknown,campaign:unknown,name:unknown,m:any,placement='all',divisor=1)=>{const spend=number(m.spend);rows.push({day:text(day).slice(0,10),campaignId:text(campaign),campaignName:typeof name==='string'?name.slice(0,500):String(campaign),placement,spend:spend===null?null:spend/divisor,impressions:number(m.impressions),clicks:number(m.clicks),conversions:number(m.conversions),conversionValue:number(m.conversionValue)});};
  if(provider==='google'){for(const r of await google(`SELECT segments.date, campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`))add(r.segments?.date,r.campaign?.id,r.campaign?.name,{...r.metrics,spend:r.metrics?.costMicros,conversionValue:r.metrics?.conversionsValue},'all',1e6);}
  if(provider==='meta'){for(const r of await cursorPages('/'+id+'/insights',{level:'campaign',time_increment:'1',time_range:JSON.stringify({since:start,until:end}),fields:'campaign_id,campaign_name,date_start,spend,impressions,clicks,actions,action_values',use_unified_attribution_setting:'true',limit:'100'})){const action=(xs:unknown)=>xs===undefined?null:list(xs).find(x=>x.action_type==='offsite_conversion.fb_pixel_purchase')?.value??null;add(r.date_start,r.campaign_id,r.campaign_name,{...r,conversions:action(r.actions),conversionValue:action(r.action_values)});}}
  if(provider==='chatgpt'){let after='';const seen=new Set<string>();do{const q=new URLSearchParams({aggregation_level:'campaign',time_granularity:'daily',limit:'1000'});q.append('time_ranges[]',JSON.stringify({type:'date_range',since:start,until:end,timezone:a.timezone}));for(const f of ['metadata.readable_time','campaign.id','campaign.name','campaign.impressions','campaign.clicks','campaign.spend'])q.append('fields[]',f);if(after)q.set('after',after);const b=await get('/ad_account/insights',{},q);for(const r of list(b.data))add(r.readable_time,r.campaign_id,r.campaign_name,r);if(typeof b.has_more!=='boolean')fail();after=b.has_more?text(b.last_id):'';if(after&&seen.has(after))fail();seen.add(after);}while(after);}
  if(provider==='line'){for(const day of daysIn(start,end)){let page=1;while(true){const b=await get('/adaccounts/'+id+'/reports/online/campaign',{since:day,until:day,page:String(page),size:'100',includeRemoved:'true'}),rs=list(b.datas);for(const r of rs){if(r.adaccount?.id!==undefined&&String(r.adaccount.id)!==id)fail();const s=r.statistics;if(!s||s.currency!==a.currency)fail('LINE広告の通貨が接続設定と一致しません。');add(day,r.campaign?.id,r.campaign?.name,{spend:s.cost,impressions:s.imp,clicks:s.click,conversions:s.cvWithCvApi});}const total=number(b.paging?.totalElements);if(total===null)fail();if(page*100>=total!)break;if(!rs.length)fail();page++;}}}
  if(provider==='tiktok'){let page=1;while(true){const b=await get('/report/integrated/get/',{advertiser_id:id,report_type:'BASIC',data_level:'AUCTION_CAMPAIGN',dimensions:JSON.stringify(['campaign_id','stat_time_day']),metrics:JSON.stringify(['campaign_name','spend','impressions','clicks','conversion']),start_date:start,end_date:end,page:String(page),page_size:'1000'});for(const r of list(b.data?.list))add(r.dimensions?.stat_time_day,r.dimensions?.campaign_id,r.metrics?.campaign_name,{...r.metrics,conversions:r.metrics?.conversion});const pages=number(b.data?.page_info?.total_page);if(pages===null)fail();if(page>=pages!)break;page++;}}
  if(provider==='x'){
   const campaigns=await cursorPages('/accounts/'+id+'/campaigns',{count:'200',with_deleted:'true'}),days=daysIn(start,end);
   for(let i=0;i<campaigns.length;i+=20){const batch=campaigns.slice(i,i+20);for(const placement of ['ALL_ON_TWITTER','SPOTLIGHT','TREND']){const b=await get('/stats/accounts/'+id,{entity:'CAMPAIGN',entity_ids:batch.map(c=>text(c.id)).join(','),granularity:'DAY',metric_groups:'ENGAGEMENT,BILLING',start_time:midnight(start,a.timezone),end_time:midnight(dayAfter(end),a.timezone),placement});if(b.time_series_length!==days.length)fail();for(const r of list(b.data)){const campaign=batch.find(c=>String(c.id)===String(r.id));if(!campaign)fail();const items=list(r.id_data);if(items.length!==1||items[0].segment!==null)fail();const m=items[0].metrics,at=(key:string,index:number)=>{const v=m?.[key];if(v===null||v===undefined)return null;if(!Array.isArray(v)||v.length!==days.length)fail();return v[index];};days.forEach((d,j)=>add(d,r.id,campaign.name,{spend:at('billed_charge_local_micro',j),impressions:at('impressions',j),clicks:at('clicks',j)},placement,1e6));}}}
  }
  if(rows.length>10000)fail('取得件数が多すぎます。期間を短くしてください。');const seen=new Set<string>();for(const r of rows){const key=JSON.stringify([r.day,r.campaignId,r.placement]);if(!validDate(r.day)||r.day<start||r.day>end||seen.has(key))fail('媒体の期間または重複行を確認できません。');seen.add(key);}return rows;
 }
 return {account,reports};
}
