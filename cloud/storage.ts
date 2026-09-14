import type { Database } from './types.ts';
export class Conflict extends Error {}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function readDocument<T>(db:Database,id:string,initial:T):Promise<{version:number;data:T}>{const row=await db.prepare('SELECT version,data FROM documents WHERE id = ?').bind(id).first<{version:number;data:string}>();return row?{version:row.version,data:JSON.parse(row.data)??initial}:{version:0,data:initial};}
export async function commitDocument<T>(db:Database,id:string,expected:number,data:T,requestId:string,signature:string):Promise<T>{
 const receiptId=id+':'+requestId;
 const replay=await db.prepare('SELECT signature FROM receipts WHERE id = ?').bind(receiptId).first<{signature:string}>();
 if(replay){if(replay.signature!==signature)throw new Conflict('操作識別子が競合しています。');return(await readDocument(db,id,data)).data;}
 await db.prepare("INSERT OR IGNORE INTO documents(id,version,data,last_request) VALUES(?,0,'null','')").bind(id).run();
 try{await db.batch([
 db.prepare('UPDATE documents SET version = ?, data = ?, last_request = ? WHERE id = ? AND version = ?').bind(expected+1,JSON.stringify(data),receiptId,id,expected),
 db.prepare('INSERT INTO receipts(id,signature,document_id) SELECT ?,?,id FROM documents WHERE id = ? AND last_request = ?').bind(receiptId,signature,id,receiptId),
 ]);}catch(e){const r=await db.prepare('SELECT signature FROM receipts WHERE id = ?').bind(receiptId).first<{signature:string}>();if(r?.signature===signature)return(await readDocument(db,id,data)).data;throw e;}
 const written=await db.prepare('SELECT signature FROM receipts WHERE id = ?').bind(receiptId).first<{signature:string}>();
 if(!written)throw new Conflict('別の画面で更新されています。再読込して変更を確認してください。');
 return data;
}
