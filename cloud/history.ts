import {audit} from './identity.ts';
import type {Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
import {readDocument,commitDocument,Conflict,digest} from './storage.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {validateBusiness} from '../lib/marketing-business/validate.ts';
import type {Env} from './types.ts';
const json=(v:unknown,status=200)=>Response.json(v,{status});
const readable=['business','measurement-policy','improvements','whiteboard','agent-skills','commerce'];
export async function history(r:Request,env:Env,user:Identity,scope:string){
 if(user.role!=='owner')return json({error:'保存履歴は全体管理者専用です。'},403);
 try{const u=new URL(r.url),key=u.searchParams.get('document')??'business';if(!readable.includes(key))throw new Error('対象の設定を選んでください。');const id=documentId(scope,key);
 if(r.method==='GET'){const rows=(await env.DB.prepare('SELECT version,at FROM document_revisions WHERE document_id=? ORDER BY version DESC LIMIT 100').bind(id).all()).results;return json({revisions:rows,current:(await readDocument(env.DB,id,null)).version});}
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 // Restoring business content is explicit and versioned; credentials, policy and grants cannot be restored here.
 if(key!=='business')throw new Error('復元に対応しているのは案件・目標・施策・タスクの設定です。ほかの設定は履歴を保管します。');
 const raw=await r.text();if(raw.length>2000)throw new Error('入力が大きすぎます。');const b=JSON.parse(raw);if(!Number.isSafeInteger(b.version)||!Number.isSafeInteger(b.expectedVersion)||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.requestId))throw new Error('版と復元理由を確認してください。');
 const row=await env.DB.prepare('SELECT data FROM document_revisions WHERE document_id=? AND version=?').bind(id,b.version).first<{data:string}>();if(!row)throw new Error('保存履歴が見つかりません。');const data=validateBusiness(JSON.parse(row.data));data.version=b.expectedVersion+1;data.updatedAt=new Date().toISOString();
 await commitDocument(env.DB,id,b.expectedVersion,data,b.requestId,await digest(raw));await audit(env,user.id,'document.restored',id,{fromVersion:b.version,toVersion:data.version,reason:b.reason});return json({version:data.version});
 }catch(e){return json({error:e instanceof Error?e.message:'処理できませんでした。'},e instanceof Conflict?409:400);}
}
