import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
import {documentId} from './business-scope.ts';
import {commitDocument,digest,readDocument} from './storage.ts';
import {emptyWhiteboard,validateWhiteboard} from '../lib/whiteboard.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function whiteboard(r:Request,env:Env,user:Identity,scope:string){
 const edit=r.method!=='GET';if(!can(user,scope,'work',edit)&&!can(user,scope,'business',edit))return json({error:'このボードの操作は許可されていません。'},403);
 const id=documentId(scope,'whiteboard'),doc=await readDocument(env.DB,id,emptyWhiteboard);
 if(r.method==='GET')return json({data:{...doc.data,version:doc.version}});
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 let body;try{const raw=await r.text();if(new TextEncoder().encode(raw).length>500000)throw new Error();body=JSON.parse(raw);}catch{return json({error:'ボードの内容を確認してください。'},400);}
 if(!body||typeof body.requestId!=='string'||!body.requestId||body.requestId.length>100||!Number.isSafeInteger(body.expectedVersion))return json({error:'操作情報を確認してください。'},400);
 const signature=await digest(JSON.stringify(body)),receipt=await env.DB.prepare('SELECT signature FROM receipts WHERE id=?').bind(id+':'+body.requestId).first<{signature:string}>();
 if(receipt)return receipt.signature===signature?json({data:{...doc.data,version:doc.version}}):json({error:'操作識別子が競合しています。'},409);
 if(body.expectedVersion!==doc.version)return json({error:'別の画面で更新されています。最新のボードを取得してください。'},409);
 let data;try{data=validateWhiteboard(body.data);}catch(e){return json({error:(e as Error).message},400);}if(data.version!==body.expectedVersion)return json({error:'更新番号を確認してください。'},400);
 data.version++;data.updatedAt=new Date().toISOString();return json({data:await commitDocument(env.DB,id,doc.version,data,body.requestId,signature)});
}
