import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../cloud/worker.ts';
import {authenticateMcp} from '../cloud/mcp.ts';
import {digest} from '../cloud/storage.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import type {Env,Statement} from '../cloud/types.ts';
async function fixture(write=true){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('owner','company','owner@example.test','所有者','unused','owner','2026-09-01')").run();
 db.prepare("INSERT INTO documents VALUES('business',0,?,'')").run(JSON.stringify(emptyBusiness));
 const token='astra_mcp_'+'a'.repeat(64),hash=await digest(token),credential={userId:'owner',userVersion:0,businessIds:['default'],write,expires:Date.now()+86400000,revoked:false,label:'test'};
 // User versions are defined by the existing schema, not by the token.
 credential.userVersion=Number(db.prepare("SELECT version FROM users WHERE id='owner'").get()!.version);
 db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('mcp-token:'+hash,JSON.stringify(credential),'test');
 class Q implements Statement{args:unknown[]=[];sql:string;constructor(sql:string){this.sql=sql;}bind(...a:unknown[]){this.args=a;return this;}async first<T>(){return db.prepare(this.sql).get(...this.args as []) as T??null;}async all<T>(){return {results:db.prepare(this.sql).all(...this.args as []) as T[]};}async run(){return {meta:{changes:Number(db.prepare(this.sql).run(...this.args as []).changes)}};}}
 const env={DB:{prepare:(sql:string)=>new Q(sql),batch:async(rows:Statement[])=>{db.exec('BEGIN');try{const r=[];for(const row of rows)r.push(await row.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},ASSETS:{fetch:async()=>new Response('asset')}} as Env;
 const fetcher:typeof fetch=async(input,init)=>worker.fetch(new Request(input,init),env);
 const client=new Client({name:'test-client',version:'1'}),transport=new StreamableHTTPClientTransport(new URL('https://test/mcp'),{fetch:fetcher,requestInit:{headers:{Authorization:'Bearer '+token}}});
 const request=()=>new Request('https://test/mcp',{headers:{Authorization:'Bearer '+token}});
 return {db,env,client,transport,request,credential,hash,fetcher};
}
test('公式SDKで初期化・一覧・取得・タスク保存と再送、競合、監査を確認する',async()=>{
 const f=await fixture();try{
 await f.client.connect(f.transport);const list=await f.client.listTools();assert.equal(list.tools.length,21);
 const tasks=await f.client.callTool({name:'get_tasks',arguments:{businessId:'default'}});assert.equal(tasks.isError,undefined);
 const save={businessId:'default',expectedVersion:0,requestId:'mcp-create-1',create:true,task:{id:'t1',title:'検証',status:'todo',priority:'high',due:'2026-10-10',notes:'',assigneeId:''}};
 const a=await f.client.callTool({name:'save_task',arguments:save});assert.equal(a.isError,undefined,JSON.stringify(a));
 assert.equal((await f.client.callTool({name:'save_task',arguments:save})).isError,undefined);
 const conflict=await f.client.callTool({name:'save_task',arguments:{...save,requestId:'other'}});assert.equal(conflict.isError,true);
 const changed=await f.client.callTool({name:'save_task',arguments:{...save,task:{...save.task,title:'changed'}}});assert.equal(changed.isError,true);
 assert.equal(JSON.parse(f.db.prepare("SELECT data FROM documents WHERE id='business'").get()!.data as string).tasks.length,1);
 assert.ok(Number(f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='mcp.updated'").get()!.n)>=1);
 assert.equal((await f.client.callTool({name:'get_tasks',arguments:{businessId:'other'}})).isError,true);
 assert.equal((await f.client.callTool({name:'get_tasks',arguments:{businessId:'default',path:'/api/owner'}})).isError,true);
 }finally{await f.client.close();f.db.close();}
});
test('読取キーは更新ツールを非表示とし、直接呼出しも拒否する',async()=>{
 const f=await fixture(false);try{await f.client.connect(f.transport);const tools=await f.client.listTools();assert.equal(tools.tools.some(t=>t.name==='save_task'),false);assert.equal((await f.client.callTool({name:'save_task',arguments:{}})).isError,true);}finally{await f.client.close();f.db.close();}
});
test('CookieではMCPに入れず、不正Origin・失効・権限変更・停止を拒否する',async()=>{
 const f=await fixture();try{
 assert.equal((await worker.fetch(new Request('https://test/mcp'),f.env)).status,401);
 assert.equal((await worker.fetch(new Request('https://test/mcp',{headers:{Origin:'https://evil.test',Authorization:f.request().headers.get('Authorization')!}}),f.env)).status,403);
 assert.ok(await authenticateMcp(f.request(),f.env));
 f.db.prepare("UPDATE users SET version=version+1 WHERE id='owner'").run();assert.equal(await authenticateMcp(f.request(),f.env),null);
 f.db.prepare('UPDATE users SET version=? WHERE id=?').run(f.credential.userVersion,'owner');
 f.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...f.credential,revoked:true}),'mcp-token:'+f.hash);assert.equal(await authenticateMcp(f.request(),f.env),null);
 f.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...f.credential,expires:1}),'mcp-token:'+f.hash);assert.equal(await authenticateMcp(f.request(),f.env),null);
 f.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(f.credential),'mcp-token:'+f.hash);f.db.prepare("DROP TRIGGER preserve_owner").run();f.db.prepare("UPDATE users SET active=0 WHERE id='owner'").run();assert.equal(await authenticateMcp(f.request(),f.env),null);
 }finally{f.db.close();}
});
test('MCPの接続中でも利用者の現在の画面権限に従ってツールを絞る',async()=>{
 const f=await fixture();try{
 f.db.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('member','company','member@example.test','担当','unused','member','2026-09-01')").run();
 const version=Number(f.db.prepare("SELECT version FROM users WHERE id='member'").get()!.version);
 f.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...f.credential,userId:'member',userVersion:version}),'mcp-token:'+f.hash);
 f.db.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) VALUES('member','default','work',1,'null')").run();
 await f.client.connect(f.transport);const tools=await f.client.listTools();assert.ok(tools.tools.some(t=>t.name==='save_task'));assert.equal(tools.tools.some(t=>t.name==='get_analytics'),false);
 f.db.prepare("DELETE FROM access_grants WHERE user_id='member'").run();assert.equal((await f.client.callTool({name:'get_tasks',arguments:{businessId:'default'}})).isError,true);
 }finally{await f.client.close();f.db.close();}
});

test('商品と売上をMCPで保存し、再送、返金、入金、取消、ページ取得を確認する',async()=>{
 const f=await fixture();try{
 await f.client.connect(f.transport);
 const call=async(name:string,args:Record<string,unknown>)=>{const result=await f.client.callTool({name,arguments:{businessId:'default',...args}});assert.equal(result.isError,undefined,JSON.stringify(result));return JSON.parse((result.content as {text:string}[])[0].text);};
 const product={id:'course',name:'動画教材',model:'content',price:12000,archived:false};
 const p=await call('save_product',{product,expectedVersion:0,requestId:'product-1'});assert.equal(p.version,1);
 const entry={id:'sale-1',productId:'course',date:'2026-10-06',quantity:2,amount:24000,fee:1000,payment:'pending',kind:'sale',originalId:'',reference:'order-1',notes:''};
 const input={entry,expectedVersion:1,requestId:'sale-request'};await call('record_sale',input);await call('record_sale',input);
 let ledger=await call('get_commerce',{period:{start:'2026-10-01',end:'2026-10-31'}});assert.equal(ledger.data.entries.length,1);assert.equal(ledger.totals.gross,24000);assert.equal(ledger.totals.pending,24000);
 assert.equal((await f.client.callTool({name:'record_sale',arguments:{businessId:'default',entry:{...entry,id:'sale-duplicate'},expectedVersion:2,requestId:'duplicate'}})).isError,true);
 await call('save_product',{product:{...product,name:'改名した教材',price:20000,archived:true},expectedVersion:2,requestId:'rename'});
 await call('mark_sale_payment',{id:'sale-1',payment:'paid',expectedVersion:3,requestId:'pay'});
 const refund={...entry,id:'refund-1',kind:'refund',originalId:'sale-1',date:'2026-10-07',amount:6000,fee:0,payment:'paid',reference:'refund-order'};
 await call('record_sale',{entry:refund,expectedVersion:4,requestId:'refund'});
 assert.equal((await f.client.callTool({name:'record_sale',arguments:{businessId:'default',entry:{...refund,id:'refund-2',amount:20000,reference:''},expectedVersion:5,requestId:'over-refund'}})).isError,true);
 assert.equal((await f.client.callTool({name:'void_sale',arguments:{businessId:'default',id:'sale-1',reason:'訂正',expectedVersion:5,requestId:'void-parent'}})).isError,true);
 await call('void_sale',{id:'refund-1',reason:'誤記帳',expectedVersion:5,requestId:'void-refund'});
 ledger=await call('get_commerce',{period:{start:'2026-10-01',end:'2026-10-31'}});assert.equal(ledger.data.entries[0].productName,'動画教材');assert.equal(ledger.totals.refunds,0);assert.equal(ledger.totals.net,23000);
 assert.equal(ledger.data.entries[1].voidReason,'誤記帳');
 const bad=await f.client.callTool({name:'save_product',arguments:{businessId:'default',product,expectedVersion:0,requestId:'conflict'}});assert.equal(bad.isError,true);
 }finally{await f.client.close();f.db.close();}
});
test('商品台帳は事業外と案件限定権限から読取も更新もできない',async()=>{
 const f=await fixture();try{
 f.db.prepare("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('restricted','company','restricted@example.test','担当','unused','member','2026-09-01')").run();
 const version=Number(f.db.prepare("SELECT version FROM users WHERE id='restricted'").get()!.version);
 f.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...f.credential,userId:'restricted',userVersion:version}),'mcp-token:'+f.hash);
 f.db.prepare("INSERT INTO access_grants(user_id,business_id,page,edit,projects) VALUES('restricted','default','business',1,'[\"p1\"]')").run();
 await f.client.connect(f.transport);
 assert.equal((await f.client.callTool({name:'get_commerce',arguments:{businessId:'default',period:{start:'2026-10-01',end:'2026-10-31'}}})).isError,true);
 assert.equal((await f.client.callTool({name:'get_commerce',arguments:{businessId:'other'}})).isError,true);
 assert.equal((await f.client.callTool({name:'save_product',arguments:{businessId:'default',expectedVersion:0,requestId:'deny',product:{id:'p1',name:'教材',model:'content',price:100,archived:false}}})).isError,true);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents WHERE id='commerce'").get()!.n,0);
 }finally{await f.client.close();f.db.close();}
});

test('MCPの売上ページ取得は全件の期間集計を保ち、続きで取りこぼさない',async()=>{
 const f=await fixture();try{
 const p={id:'course',name:'教材',model:'content',price:100,archived:false,updatedAt:''};
 const entries=Array.from({length:101},(_,i)=>({id:'sale-'+i,productId:'course',productName:'教材',model:'content',date:'2026-10-06',quantity:1,amount:100,fee:0,payment:'paid',kind:'sale',originalId:'',reference:'',notes:'',createdAt:'',updatedAt:'',voidReason:''}));
 f.db.prepare("INSERT INTO documents VALUES('commerce',1,?,'')").run(JSON.stringify({products:[p],entries}));
 await f.client.connect(f.transport);
 const first=await f.client.callTool({name:'get_commerce',arguments:{businessId:'default',period:{start:'2026-10-01',end:'2026-10-31'}}});assert.equal(first.isError,undefined);const a=JSON.parse((first.content as {text:string}[])[0].text);assert.equal(a.data.entries.length,100);assert.equal(a.nextCursor,'100');assert.equal(a.totals.gross,10100);
 const next=await f.client.callTool({name:'get_commerce',arguments:{businessId:'default',period:{start:'2026-10-01',end:'2026-10-31'},cursor:a.nextCursor}});assert.equal(next.isError,undefined);const b=JSON.parse((next.content as {text:string}[])[0].text);assert.equal(b.data.entries.length,1);assert.equal(b.nextCursor,null);assert.equal(b.totals.gross,10100);assert.equal(new Set([...a.data.entries,...b.data.entries].map(e=>e.id)).size,101);
 }finally{await f.client.close();f.db.close();}
});
