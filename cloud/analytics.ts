import {documentId} from './business-scope.ts';
import { validateFact,validDate,type Fact } from '../lib/analytics/model.ts';
import { emptyBusiness } from '../lib/marketing-business/types.ts';
import type { Env } from './types.ts';
import { readDocument,digest } from './storage.ts';
export async function analytics(r:Request,env:Env,scope='default',projects:string[]|null=null){const json=(b:unknown,status=200)=>Response.json(b,{status});const u=new URL(r.url);
 if(r.method==='GET'){
 const start=u.searchParams.get('start')??'2000-01-01',end=u.searchParams.get('end')??'2100-01-01',cursor=u.searchParams.get('cursor')??'';
 if(!validDate(start)||!validDate(end)||start>end||cursor.length>100)return json({error:'期間を確認してください。'},400);
 const result=await env.DB.prepare('SELECT id,data FROM analytics_rows WHERE business_id = ? AND date >= ? AND date <= ? AND id > ? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?))) ORDER BY id LIMIT 501').bind(scope,start,end,cursor,projects===null?null:JSON.stringify(projects),JSON.stringify(projects)).all<{id:string;data:string}>();const rows=result.results.slice(0,500);return json({rows:rows.map(x=>JSON.parse(x.data)),nextCursor:result.results.length>500?rows.at(-1)!.id:null});
 }
 if(projects!==null)return json({error:'案件を限定した権限では実績の取込はできません。'},403);
 if(r.method!=='POST')return json({error:'操作できません。'},405);
 try{
 const raw=await r.text();if(new TextEncoder().encode(raw).length>500000)return json({error:'一度に取り込めるサイズを超えています。'},413);const b=JSON.parse(raw);
 if(!b||!['preview','import'].includes(b.action)||typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)return json({error:'1回に1〜100行を指定してください。'},400);
 const requestId=scope==='default'?b.requestId:scope+':'+b.requestId;
 const signature=await digest(JSON.stringify(b.rows));
 const receipt=await env.DB.prepare('SELECT signature,count FROM analytics_imports WHERE id = ? AND business_id = ?').bind(requestId,scope).first<{signature:string;count:number}>();if(receipt)return receipt.signature===signature?json({count:receipt.count,replayed:true}):json({error:'操作識別子が競合しています。'},409);
 const business=(await readDocument(env.DB,documentId(scope,'business'),emptyBusiness)).data,rows:Fact[]=[];const keys=new Set();
 for(const [i,input] of b.rows.entries()){
 let parsed;try{parsed=validateFact(input,business);}catch(e){return json({error:`${i+1}行目：${(e as Error).message}`},400);}
 const id=await digest(JSON.stringify(scope==='default'?[parsed.source,parsed.externalId]:[scope,parsed.source,parsed.externalId]));if(keys.has(id))return json({error:`${i+1}行目：元データIDが重複しています。`},409);keys.add(id);
 rows.push({...parsed,id,funnel:business.funnels!.find(f=>f.id===parsed.funnelId)!});
 }
 const existing=await env.DB.prepare('SELECT id FROM analytics_rows WHERE id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(JSON.stringify(rows.map(row=>row.id))).first<{id:string}>();if(existing)return json({error:`${rows.findIndex(row=>row.id===existing.id)+1}行目：すでに登録済みです。上書きせず停止しました。`},409);
 if(b.action==='preview')return json({rows,count:rows.length,businessVersion:business.version});
 if(b.businessVersion!==business.version)return json({error:'ファネル設定が変わっています。再度プレビューしてください。'},409);
 try{await env.DB.batch([env.DB.prepare('INSERT INTO analytics_imports(id,signature,created_at,count,business_id) VALUES(?,?,?,?,?)').bind(requestId,signature,new Date().toISOString(),rows.length,scope),env.DB.prepare("INSERT INTO analytics_rows(id,source,external_id,project_id,date,data,import_id,business_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.source'),json_extract(value,'$.externalId'),json_extract(value,'$.projectId'),json_extract(value,'$.date'),value,?,? FROM json_each(?)").bind(requestId,scope,JSON.stringify(rows))]);}catch{const replay=await env.DB.prepare('SELECT signature,count FROM analytics_imports WHERE id = ? AND business_id = ?').bind(requestId,scope).first<{signature:string;count:number}>();if(replay?.signature===signature)return json({count:replay.count,replayed:true});return json({error:'重複または競合が発生しました。再読込して確認してください。'},409);}
 return json({count:rows.length});
 }catch{return json({error:'入力形式を確認してください。'},400);}
}
