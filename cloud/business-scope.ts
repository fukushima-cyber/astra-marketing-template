import type {Env} from './types.ts';
export const documentId=(businessId:string,id:string)=>businessId==='default'?id:`${businessId}:${id}`;
export async function resolveBusiness(r:Request,env:Env){const id=r.headers.get('X-Astra-Business')??new URL(r.url).searchParams.get('businessId')??'default';if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))return null;return await env.DB.prepare('SELECT id,name FROM businesses WHERE id=?').bind(id).first<{id:string;name:string}>();}
export async function businesses(r:Request,env:Env){
 if(r.method==='GET')return Response.json({businesses:(await env.DB.prepare('SELECT id,name,created_at FROM businesses ORDER BY created_at,id').all()).results});
 if(r.method!=='POST')return Response.json({error:'操作できません。'},{status:405});
 let b;try{const text=await r.text();if(text.length>2000)throw new Error();b=JSON.parse(text);}catch{return Response.json({error:'入力を確認してください。'},{status:400});}
 if(typeof b?.name!=='string'||!b.name.trim()||b.name.length>100||!['create','rename'].includes(b.action)||typeof b.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(b.id))return Response.json({error:'事業名を確認してください。'},{status:400});
 if(b.action==='create'){const count=await env.DB.prepare('SELECT count(*) AS n FROM businesses').first<{n:number}>();if((count?.n??0)>=100)return Response.json({error:'事業は100件までです。'},{status:400});await env.DB.prepare('INSERT OR IGNORE INTO businesses(id,name,created_at) VALUES(?,?,?)').bind(b.id,b.name.trim(),new Date().toISOString()).run();}
 else await env.DB.prepare('UPDATE businesses SET name=? WHERE id=?').bind(b.name.trim(),b.id).run();
 const row=await env.DB.prepare('SELECT id,name FROM businesses WHERE id=?').bind(b.id).first();return Response.json(row??{error:'事業が見つかりません。'},{status:row?200:404});
}
