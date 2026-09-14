import type {Env} from './types.ts';
import {digest} from './storage.ts';
import {audit,cookie,currentUser,newSession,normalizeEmail,randomToken,validEmail} from './identity.ts';
const enc=new TextEncoder();
export const sameOrigin=(r:Request)=>r.headers.get('sec-fetch-site')!=='cross-site'&&r.headers.get('origin')===new URL(r.url).origin;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function passwordHash(password:string,secret:string,salt=randomToken()){
 const pepper=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const material=await crypto.subtle.sign('HMAC',pepper,enc.encode(password));
 const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);
 return 'v1:'+salt+':'+Array.from(new Uint8Array(bits),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function checkPassword(password:string,stored:string,secret:string){const parts=stored.split(':');return parts.length===3&&parts[0]==='v1'&&await passwordHash(password,secret,parts[1])===stored;}
export async function authenticated(r:Request,env:Env){return !!await currentUser(r,env);}
export function authPage(mode:'login'|'join'='login',message='',status=200){
 const join=mode==='join';return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${join?'利用を開始':'ログイン'}｜会社ダッシュボード</title><style>body{margin:0;background:#f4f7fb;color:#172c43;font:16px system-ui;display:grid;min-height:100dvh;place-items:center}main{background:white;padding:36px;border:1px solid #d6e0eb;border-radius:16px;width:min(410px,calc(100vw - 100px))}h1{font-size:26px}p{line-height:1.8;color:#526579}label{display:block;margin-top:18px}input,button{font:inherit;box-sizing:border-box;width:100%;padding:13px;border:1px solid #8c9cac;border-radius:7px;margin-top:6px}button{background:#174fe5;color:white;cursor:pointer;margin-top:24px}a{color:#154de2}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #ffb900;outline-offset:3px}.error{color:#a42121}small{display:block;line-height:1.6}</style></head><body><main><small>会社ダッシュボード</small><h1>${join?'あなたのアカウントを登録':'ログイン'}</h1><p>${join?'招待された方専用の登録画面です。再設定リンクの場合も、新しいパスワードを入力してください。':'自分のアカウントで、担当する事業と仕事へ。'}</p>${message?`<p class="error" role="alert">${escape(message)}</p>`:''}<form method="post" action="/${mode}" id="auth-form">${join?'<input type="hidden" name="token" id="invite-token"><label>表示名<input name="name" autocomplete="name" required maxlength="80"></label>':''}<label>メールアドレス<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>パスワード<input name="password" type="password" autocomplete="${join?'new-password':'current-password'}" required ${join?'minlength="12"':''} maxlength="200"></label>${join?'<small>12文字以上。ほかのサービスと違うパスワードを設定してください。</small><label>パスワード（確認）<input name="confirmation" type="password" autocomplete="new-password" required maxlength="200"></label>':''}<button>${join?'登録・再設定して開く':'ログイン'}</button></form><p>${join?'<a href="/login">ログインに戻る</a>':'初めての方・パスワードを忘れた方は、全体管理者から登録・再設定リンクを受け取ってください。'}</p><small>Googleアカウントとの認証連携はまだ設定されていません。</small>${join?'<script src="/auth-form.js" defer></script>':''}</main></body></html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export const loginPage=()=>authPage();
export function authScript(){return new Response(`const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';document.getElementById('invite-token').value=token;if(!/^[a-f0-9]{64}$/.test(token)){document.querySelector('button').disabled=true;const p=document.createElement('p');p.textContent='登録リンクをもう一度開いてください。';p.setAttribute('role','alert');document.querySelector('form').prepend(p);}`,{headers:{'Content-Type':'text/javascript;charset=utf-8'}});}
async function limited(r:Request,env:Env,email:string){const minute=Math.floor(Date.now()/60000),keys=[await digest('ip:'+(r.headers.get('cf-connecting-ip')??'local'))+':'+minute,await digest('email:'+email)+':'+Math.floor(minute/10)];for(const id of keys){const row=await env.DB.prepare('INSERT INTO login_limits(id,attempts,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(id,minute+15).first<{attempts:number}>();if(!row||row.attempts>10)return true;}await env.DB.prepare('DELETE FROM login_limits WHERE expires<?').bind(minute).run();return false;}
export async function login(r:Request,env:Env,join=false){
 const mode=join?'join':'login';if(!sameOrigin(r))return authPage(mode,'接続元が一致しません。',403);
 if(!env.SESSION_SECRET)return authPage(mode,'認証の設定を確認してください。',503);
 const raw=await r.text();if(raw.length>4000)return authPage(mode,'入力が長すぎます。',413);
 const form=new URLSearchParams(raw),email=normalizeEmail(form.get('email')),password=form.get('password')??'';
 if(await limited(r,env,email))return authPage(mode,'しばらく待ってからお試しください。',429);
 if(!validEmail(email)||password.length>200)return authPage(mode,'入力内容を確認してください。',400);
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
export async function logout(r:Request,env:Env){await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash=?').bind(await digest(cookie(r,'__Host-astra-user'))).run();return new Response(null,{status:303,headers:{Location:'/login','Set-Cookie':'__Host-astra-user=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});}
