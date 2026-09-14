import type {Database} from './types.ts';
import {Conflict} from './storage.ts';
export async function commitWithTarget(db:Database,s:{id:string;version:number;data:unknown},t:{id:string;version:number;data:unknown},requestId:string,signature:string){const receipt=s.id+':'+requestId;await db.prepare("INSERT OR IGNORE INTO documents(id,version,data,last_request) VALUES(?,0,'null','')").bind(t.id).run();await db.batch([
 db.prepare('UPDATE documents SET version=?,data=?,last_request=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM documents WHERE id=? AND version=?)').bind(t.version+1,JSON.stringify(t.data),receipt,t.id,t.version,s.id,s.version),
 db.prepare('UPDATE documents SET version=?,data=?,last_request=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM documents WHERE id=? AND last_request=?)').bind(s.version+1,JSON.stringify(s.data),receipt,s.id,s.version,t.id,receipt),
 db.prepare('INSERT OR IGNORE INTO receipts(id,signature,document_id) SELECT ?,?,id FROM documents WHERE id=? AND last_request=?').bind(receipt,signature,s.id,receipt)
 ]);const r=await db.prepare('SELECT signature FROM receipts WHERE id=?').bind(receipt).first<{signature:string}>();if(r?.signature!==signature)throw new Conflict('データが更新されました。再取得して確認してください。');}
