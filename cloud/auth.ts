import {boundedText,BodyTooLarge} from './bounded-body.ts';
import type {Env} from './types.ts';
import {digest} from './storage.ts';
import {audit,cookie,currentUser,newSession,normalizeEmail,randomToken,validEmail} from './identity.ts';

const enc=new TextEncoder();
const GOOGLE_AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL='https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_STATE_COOKIE='__Host-astra-google-state';
const clearGoogleState=`${GOOGLE_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
type Fetcher=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;
type GoogleClaims={iss?:unknown;aud?:unknown;azp?:unknown;sub?:unknown;email?:unknown;email_verified?:unknown;name?:unknown;exp?:unknown;iat?:unknown;nonce?:unknown};

export const sameOrigin=(r:Request)=>r.headers.get('sec-fetch-site')!=='cross-site'&&r.headers.get('origin')===new URL(r.url).origin;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const googleConfigured=(env:Env)=>Boolean(env.GOOGLE_CLIENT_ID?.trim()&&env.GOOGLE_CLIENT_SECRET?.trim());

export async function passwordHash(password:string,secret:string,salt=randomToken()){
 const pepper=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const material=await crypto.subtle.sign('HMAC',pepper,enc.encode(password));
 const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);
 return 'v1:'+salt+':'+Array.from(new Uint8Array(bits),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function checkPassword(password:string,stored:string,secret:string){const parts=stored.split(':');return parts.length===3&&parts[0]==='v1'&&await passwordHash(password,secret,parts[1])===stored;}
export async function authenticated(r:Request,env:Env){return !!await currentUser(r,env);}

export function authPage(mode:'login'|'join'='login',message='',status=200,useGoogle=false){
 const join=mode==='join';
 const loginContent=useGoogle
  ?`<a class="google-button" href="/auth/google"><span aria-hidden="true">G</span>Googleでログイン</a><p class="hint">登録済みのメールアドレスと同じGoogleアカウントを選んでください。</p>`
  :`<form method="post" action="/login" id="auth-form"><label>メールアドレス<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>パスワード<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button>ログイン</button></form><p class="hint">Googleログインの設定が完了するまでは、現在のログイン方法を利用できます。</p>`;
 const legacyJoin=`<form method="post" action="/join" id="auth-form"><input type="hidden" name="token" id="invite-token"><label>表示名<input name="name" autocomplete="name" required maxlength="80"></label><label>メールアドレス<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>パスワード<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="200"></label><small>12文字以上。ほかのサービスと違うパスワードを設定してください。</small><label>パスワード（確認）<input name="confirmation" type="password" autocomplete="new-password" required maxlength="200"></label><button>登録・再設定して開く</button></form>`;
 const googleJoin=`<a class="google-button" id="invite-google" href="/auth/google"><span aria-hidden="true">G</span>Googleで利用を開始</a><p class="hint">招待されたメールアドレスと同じGoogleアカウントを選んでください。パスワードの登録は不要です。</p>`;
 const joinContent=`${useGoogle?googleJoin:legacyJoin}<p><a href="/login">ログインに戻る</a></p><script src="/auth-form.js" defer></script>`;
 return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${join?'利用を開始':'ログイン'}｜会社ダッシュボード</title><style>body{margin:0;background:#f4f7fb;color:#172c43;font:15px system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{background:#fff;padding:32px;border:1px solid #d6e0eb;border-radius:14px;width:min(380px,calc(100vw - 64px));box-shadow:0 12px 30px #18344d12}h1{font-size:24px;margin:8px 0}p{line-height:1.7;color:#526579}label{display:block;margin-top:16px;font-weight:600}input,button{font:inherit;box-sizing:border-box;width:100%;min-height:44px;padding:11px 12px;border:1px solid #8c9cac;border-radius:7px;margin-top:6px}button{background:#174fe5;color:#fff;border-color:#174fe5;cursor:pointer;margin-top:22px;font-weight:700}.google-button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;margin-top:24px;padding:11px 16px;border:1px solid #718096;border-radius:7px;background:#fff;color:#172c43;text-decoration:none;font-weight:700}.google-button:hover{background:#edf3f9}.google-button[aria-disabled="true"]{color:#718096;background:#eef2f6;pointer-events:none}.google-button span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:#174fe5;font-size:18px;font-weight:800}a{color:#154de2}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #ffb900;outline-offset:3px}.error{padding:10px 12px;border-left:4px solid #a42121;background:#fff3f3;color:#7f1d1d}.hint{font-size:13px}small{display:block;line-height:1.6;color:#526579}@media(max-width:520px){main{padding:26px 22px;width:calc(100vw - 40px)}}</style></head><body><main><small>会社ダッシュボード</small><h1>${join?'招待されたアカウントを開く':'ログイン'}</h1><p>${join?(useGoogle?'Googleで本人確認すると、付与された画面を利用できます。':'招待された方専用の登録画面です。'):'担当する事業と仕事を開きます。'}</p>${message?`<p class="error" role="alert">${escape(message)}</p>`:''}${join?joinContent:loginContent}</main></body></html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none"}});
}

export const loginPage=(env:Env,message='',status=200)=>authPage('login',message,status,googleConfigured(env));
export function authScript(){return new Response(`const token=new URLSearchParams(location.hash.slice(1)).get('token')||'',valid=/^[a-f0-9]{64}$/.test(token),input=document.getElementById('invite-token'),link=document.getElementById('invite-google');if(input)input.value=token;if(link){link.href=valid?'/auth/google?invite='+encodeURIComponent(token):'#';link.setAttribute('aria-disabled',String(!valid));}if(!valid){const button=document.querySelector('button');if(button)button.disabled=true;const p=document.createElement('p');p.textContent='招待リンクをもう一度開いてください。';p.setAttribute('role','alert');(document.querySelector('form')||link)?.before(p);}`,{headers:{'Content-Type':'text/javascript;charset=utf-8','Cache-Control':'no-store'}});}

function googleError(env:Env,message:string,status=400){
 const page=loginPage(env,message,status),headers=new Headers(page.headers);headers.append('Set-Cookie',clearGoogleState);
 return new Response(page.body,{status,headers});
}
function base64UrlBytes(value:string){
 const base64=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4),binary=atob(base64);
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function parsePart(value:string){
 const bytes=base64UrlBytes(value),text=new TextDecoder().decode(bytes),parsed=JSON.parse(text) as unknown;
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid token');
 return parsed as Record<string,unknown>;
}
async function boundedJson(response:Response,maxBytes:number){
 const text=await response.text();if(text.length>maxBytes)throw new Error('response too large');
 const parsed=JSON.parse(text) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid response');return parsed as Record<string,unknown>;
}

export async function verifyGoogleIdToken(idToken:string,clientId:string,nonce:string,fetcher:Fetcher=fetch):Promise<{sub:string;email:string;name:string}>{
 if(idToken.length>20000)throw new Error('invalid token');
 const parts=idToken.split('.');if(parts.length!==3)throw new Error('invalid token');
 const header=parsePart(parts[0]),claims=parsePart(parts[1]) as GoogleClaims;
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)throw new Error('invalid token');
 const jwksResponse=await fetcher(GOOGLE_JWKS_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!jwksResponse.ok)throw new Error('keys unavailable');
 const jwks=await boundedJson(jwksResponse,100000),keys=Array.isArray(jwks.keys)?jwks.keys:[];
 const jwk=keys.find(key=>key&&typeof key==='object'&&!Array.isArray(key)&&(key as Record<string,unknown>).kid===header.kid) as JsonWebKey|undefined;
 if(!jwk||jwk.kty!=='RSA')throw new Error('key unavailable');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64UrlBytes(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
 if(!valid)throw new Error('invalid signature');
 const now=Math.floor(Date.now()/1000),audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!['accounts.google.com','https://accounts.google.com'].includes(String(claims.iss))||!audience.includes(clientId)||audience.length>1&&claims.azp!==clientId||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+300||claims.nonce!==nonce||claims.email_verified!==true||typeof claims.sub!=='string'||claims.sub.length<1||claims.sub.length>255)throw new Error('invalid claims');
 const email=normalizeEmail(claims.email);if(!validEmail(email))throw new Error('invalid email');
 const name=typeof claims.name==='string'&&claims.name.trim()?claims.name.trim().slice(0,80):email.split('@')[0].slice(0,80);
 return {sub:claims.sub,email,name};
}

export async function googleStart(r:Request,env:Env){
 if(!googleConfigured(env))return googleError(env,'Googleログインの設定がまだ完了していません。',503);
 const requestUrl=new URL(r.url);if(requestUrl.protocol!=='https:'&&requestUrl.hostname!=='localhost'&&requestUrl.hostname!=='127.0.0.1')return googleError(env,'安全な接続から開いてください。',400);
 const minute=Math.floor(Date.now()/60000),limitId=await digest('google-ip:'+(r.headers.get('cf-connecting-ip')??'local'))+':'+minute;
 const attempt=await env.DB.prepare('INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(limitId,minute+15).first<{attempts:number}>();
 if(!attempt||attempt.attempts>20)return googleError(env,'しばらく待ってからお試しください。',429);
 const inviteToken=requestUrl.searchParams.get('invite')??'';let inviteHash:string|null=null;
 if(inviteToken){
  if(!/^[a-f0-9]{64}$/.test(inviteToken))return authPage('join','招待リンクをもう一度開いてください。',400,true);
  inviteHash=await digest(inviteToken);const invite=await env.DB.prepare('SELECT token_hash FROM invitations WHERE token_hash=? AND expires>? AND used_by IS NULL AND revoked=0').bind(inviteHash,Date.now()).first();
  if(!invite)return authPage('join','この招待リンクは無効または期限切れです。',400,true);
 }
 const state=randomToken(),nonce=randomToken(),expires=Date.now()+10*60*1000;
 await env.DB.prepare('DELETE FROM oauth_states WHERE expires<=?').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO oauth_states(state_hash,nonce,expires,invite_hash) VALUES(?,?,?,?)').bind(await digest(state),nonce,expires,inviteHash).run();
 const redirectUri=new URL('/auth/google/callback',requestUrl).toString(),params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!.trim(),redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,nonce});
 return new Response(null,{status:303,headers:{Location:`${GOOGLE_AUTH_URL}?${params}`,'Set-Cookie':`${GOOGLE_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export async function googleCallback(r:Request,env:Env,fetcher:Fetcher=fetch){
 if(!googleConfigured(env))return googleError(env,'Googleログインの設定がまだ完了していません。',503);
 const url=new URL(r.url),state=url.searchParams.get('state')??'',code=url.searchParams.get('code')??'',providerError=url.searchParams.get('error'),stateCookie=cookie(r,GOOGLE_STATE_COOKIE);
 if(!/^[a-f0-9]{64}$/.test(state)||state!==stateCookie||!providerError&&(!code||code.length>4096))return googleError(env,'ログインの有効時間が切れました。もう一度お試しください。',400);
 const saved=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires>? RETURNING nonce,invite_hash').bind(await digest(state),Date.now()).first<{nonce:string;invite_hash:string|null}>();
 if(!saved)return googleError(env,'ログインの有効時間が切れました。もう一度お試しください。',400);
 if(providerError)return googleError(env,providerError==='access_denied'?'Googleログインをキャンセルしました。':'Googleログインを完了できませんでした。',400);
 let identity:{sub:string;email:string;name:string};
 try{
  const redirectUri=new URL('/auth/google/callback',url).toString();
  const tokenResponse=await fetcher(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID!.trim(),client_secret:env.GOOGLE_CLIENT_SECRET!.trim(),redirect_uri:redirectUri,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
  if(!tokenResponse.ok)throw new Error('token exchange failed');
  const tokens=await boundedJson(tokenResponse,50000);if(typeof tokens.id_token!=='string')throw new Error('missing id token');
  identity=await verifyGoogleIdToken(tokens.id_token,env.GOOGLE_CLIENT_ID!.trim(),saved.nonce,fetcher);
 }catch{return googleError(env,'Googleとの認証を確認できませんでした。もう一度お試しください。',502);}
 type UserRow={id:string;email:string;active:number;google_sub:string|null};
 if(saved.invite_hash){
  const invite=await env.DB.prepare('SELECT company_id,email,role,grants,kind,target_id FROM invitations WHERE token_hash=? AND expires>? AND used_by IS NULL AND revoked=0').bind(saved.invite_hash,Date.now()).first<{company_id:string;email:string|null;role:string;grants:string;kind:string;target_id:string|null}>();
  if(!invite||!invite.email||normalizeEmail(invite.email)!==identity.email)return googleError(env,'招待されたメールアドレスとGoogleアカウントが一致しません。招待先のGoogleアカウントを選んでください。',403);
  const now=new Date().toISOString(),userId=invite.target_id??crypto.randomUUID();
  try{
   if(invite.kind==='reset'){
    const target=await env.DB.prepare('SELECT id,active,google_sub FROM users WHERE id=? AND email=?').bind(userId,identity.email).first<{id:string;active:number;google_sub:string|null}>();
    if(!target?.active||target.google_sub&&target.google_sub!==identity.sub)return googleError(env,'このGoogleアカウントは対象のスタッフと一致しません。',409);
    await env.DB.batch([
     env.DB.prepare('UPDATE users SET google_sub=COALESCE(google_sub,?),google_linked_at=COALESCE(google_linked_at,?),version=version+1 WHERE id=? AND active=1 AND (google_sub IS NULL OR google_sub=?)').bind(identity.sub,now,userId,identity.sub),
     env.DB.prepare('UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND google_sub=?)').bind(userId,saved.invite_hash,Date.now(),userId,identity.sub),
     env.DB.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId),
    ]);
   }else{
    if(await env.DB.prepare('SELECT id FROM users WHERE email=? OR google_sub=?').bind(identity.email,identity.sub).first())return googleError(env,'このスタッフは登録済みです。通常のGoogleログインを利用してください。',409);
    await env.DB.batch([
     env.DB.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at,google_sub,google_linked_at) SELECT ?,company_id,?,?, '!google-login-only!',role,?,?,? FROM invitations WHERE token_hash=? AND email=? AND expires>? AND used_by IS NULL AND revoked=0").bind(userId,identity.email,identity.name,now,identity.sub,now,saved.invite_hash,identity.email,Date.now()),
     env.DB.prepare('UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND google_sub=?)').bind(userId,saved.invite_hash,Date.now(),userId,identity.sub),
     env.DB.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) SELECT ?,json_extract(g.value,'$.businessId'),json_extract(g.value,'$.page'),json_extract(g.value,'$.edit'),COALESCE(json_extract(g.value,'$.projects'),'null') FROM invitations i,json_each(i.grants) g WHERE i.token_hash=? AND i.used_by=?").bind(userId,saved.invite_hash,userId),
    ]);
   }
  }catch{return googleError(env,'スタッフアカウントを登録できませんでした。招待リンクを開き直してください。',409);}
  const consumed=await env.DB.prepare('SELECT used_by FROM invitations WHERE token_hash=?').bind(saved.invite_hash).first<{used_by:string}>(),created=await env.DB.prepare('SELECT id,active,google_sub FROM users WHERE id=?').bind(userId).first<{id:string;active:number;google_sub:string|null}>();
  if(consumed?.used_by!==userId||!created?.active||created.google_sub!==identity.sub)return googleError(env,'この招待リンクは使用できません。管理者に再発行を依頼してください。',409);
  await audit(env,userId,invite.kind==='reset'?'account.google_relinked':'account.google_enrolled',userId);
  const headers=new Headers({Location:'/company','Cache-Control':'no-store'});headers.append('Set-Cookie',await newSession(env,userId));headers.append('Set-Cookie',clearGoogleState);
  return new Response(null,{status:303,headers});
 }
 const bySub=await env.DB.prepare('SELECT id,email,active,google_sub FROM users WHERE google_sub=?').bind(identity.sub).first<UserRow>();
 const byEmail=await env.DB.prepare('SELECT id,email,active,google_sub FROM users WHERE email=?').bind(identity.email).first<UserRow>();
 const user=bySub??byEmail;
 if(!user||!user.active)return googleError(env,'このGoogleアカウントは招待されていません。管理者に登録を依頼してください。',403);
 if(user.google_sub&&user.google_sub!==identity.sub)return googleError(env,'このメールアドレスは別のGoogleアカウントに登録されています。',409);
 if(!user.google_sub){
  try{const linked=await env.DB.prepare('UPDATE users SET google_sub=?,google_linked_at=? WHERE id=? AND google_sub IS NULL AND active=1').bind(identity.sub,new Date().toISOString(),user.id).run();if(linked.meta.changes!==1)throw new Error('not linked');}
  catch{return googleError(env,'Googleアカウントを登録できませんでした。管理者に確認してください。',409);}
  await audit(env,user.id,'account.google_linked',user.id);
 }
 await audit(env,user.id,'session.google_login',user.id);
 const headers=new Headers({Location:'/company','Cache-Control':'no-store'});headers.append('Set-Cookie',await newSession(env,user.id));headers.append('Set-Cookie',clearGoogleState);
 return new Response(null,{status:303,headers});
}

async function limited(r:Request,env:Env,email:string){const minute=Math.floor(Date.now()/60000),keys=[await digest('ip:'+(r.headers.get('cf-connecting-ip')??'local'))+':'+minute,await digest('email:'+email)+':'+Math.floor(minute/10)];for(const id of keys){const row=await env.DB.prepare('INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(id,minute+15).first<{attempts:number}>();if(!row||row.attempts>10)return true;}await env.DB.prepare('DELETE FROM login_limits WHERE expires<?').bind(minute).run();return false;}
export async function login(r:Request,env:Env,join=false){
 const mode=join?'join':'login';if(!sameOrigin(r))return authPage(mode,'接続元が一致しません。',403,googleConfigured(env));
 if(!join&&googleConfigured(env))return loginPage(env,'Googleでログインしてください。',405);
 if(!env.SESSION_SECRET)return authPage(mode,'認証の設定を確認してください。',503,googleConfigured(env));
 const minute=Math.floor(Date.now()/60000),ipKey=await digest('body:'+ (r.headers.get('cf-connecting-ip')??'local'))+':'+minute;
 const attempt=await env.DB.prepare('INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(ipKey,minute+15).first<{attempts:number}>();
 if(!attempt||attempt.attempts>20){await r.body?.cancel();return authPage(mode,'しばらく待ってからお試しください。',429,googleConfigured(env));}
 let raw:string;try{raw=await boundedText(r,4000);}catch(e){if(e instanceof BodyTooLarge)return authPage(mode,'入力が長すぎます。',413,googleConfigured(env));throw e;}
 const form=new URLSearchParams(raw),email=normalizeEmail(form.get('email')),password=form.get('password')??'';
 if(await limited(r,env,email))return authPage(mode,'しばらく待ってからお試しください。',429,googleConfigured(env));
 if(!validEmail(email)||password.length>200)return authPage(mode,'入力内容を確認してください。',400,googleConfigured(env));
 let userId:string;
 if(join){
  const name=(form.get('name')??'').trim(),token=form.get('token')??'';
  if(password.length<12||password!==form.get('confirmation')||!name||name.length>80||!/^[a-f0-9]{64}$/.test(token))return authPage(mode,'表示名、12文字以上のパスワード、確認欄を確かめてください。',400);
  const hash=await digest(token),invite=await env.DB.prepare('SELECT role,email,kind,target_id FROM invitations WHERE token_hash=? AND expires>? AND used_by IS NULL AND revoked=0').bind(hash,Date.now()).first<{role:string;email:string|null;kind:string;target_id:string|null}>();
  if(!invite||invite.email&&invite.email!==email)return authPage(mode,'リンクが無効・期限切れ、または招待先とメールアドレスが違います。',400);
  const stored=await passwordHash(password,env.SESSION_SECRET),now=new Date().toISOString();userId=invite.target_id??crypto.randomUUID();
  try{
   if(invite.kind==='reset'){
    await env.DB.batch([
     env.DB.prepare("UPDATE users SET password_hash=?,version=version+1 WHERE id=? AND active=1 AND EXISTS(SELECT 1 FROM invitations WHERE token_hash=? AND target_id=users.id AND email=users.email AND expires>? AND used_by IS NULL AND revoked=0)").bind(stored,userId,hash,Date.now()),
     env.DB.prepare('UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(userId,hash,Date.now(),userId,stored),
    ]);
   }else{
    await env.DB.batch([
     env.DB.prepare('INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) SELECT ?,company_id,?,?,?,role,? FROM invitations WHERE token_hash=? AND expires>? AND used_by IS NULL AND revoked=0').bind(userId,email,name,stored,now,hash,Date.now()),
     env.DB.prepare('UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM users WHERE id=?)').bind(userId,hash,Date.now(),userId),
     env.DB.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) SELECT ?,json_extract(g.value,'$.businessId'),json_extract(g.value,'$.page'),json_extract(g.value,'$.edit'),COALESCE(json_extract(g.value,'$.projects'),'null') FROM invitations i,json_each(i.grants) g WHERE i.token_hash=? AND i.used_by=?").bind(userId,hash,userId),
    ]);
   }
  }catch{return authPage(mode,'登録できませんでした。使用済みリンクや登録済みアカウントでないか確認してください。',409);}
  const consumed=await env.DB.prepare('SELECT used_by FROM invitations WHERE token_hash=?').bind(hash).first<{used_by:string}>();
  const actual=await env.DB.prepare('SELECT password_hash FROM users WHERE id=? AND active=1').bind(userId).first<{password_hash:string}>();
  if(consumed?.used_by!==userId||actual?.password_hash!==stored)return authPage(mode,'このリンクは使用できません。',409);
  await audit(env,userId,invite.kind==='reset'?'password.reset':'account.enrolled',userId);
 }else{
  const user=await env.DB.prepare('SELECT id,password_hash,active FROM users WHERE email=?').bind(email).first<{id:string;password_hash:string;active:number}>();
  const ok=user?await checkPassword(password,user.password_hash,env.SESSION_SECRET):(await passwordHash(password,env.SESSION_SECRET),false);
  if(!user||!ok||!user.active)return authPage(mode,'メールアドレスまたはパスワードを確認してください。',401);userId=user.id;
  await audit(env,userId,'session.login',userId);
 }
 return new Response(null,{status:303,headers:{Location:'/company','Set-Cookie':await newSession(env,userId),'Cache-Control':'no-store'}});
}
export async function logout(r:Request,env:Env){await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash=?').bind(await digest(cookie(r,'__Host-astra-user'))).run();return new Response(null,{status:303,headers:{Location:'/login?signedOut=1','Set-Cookie':'__Host-astra-user=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});}
