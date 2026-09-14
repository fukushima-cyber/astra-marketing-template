import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { validateFact,total,ratio,previousPeriod,delta,validDate,type Fact,type FactInput } from '../lib/analytics/model.ts';
import { columns,importCsv,parseCsv } from '../lib/analytics/csv.ts';
import { emptyBusiness } from '../lib/marketing-business/types.ts';
import { analytics } from '../cloud/analytics.ts';
import type { Env,Statement } from '../cloud/types.ts';
const funnel={id:'f1',projectId:'p1',name:'相談へ',source:'sns' as const,medium:'X',status:'active' as const,goalIds:[],notes:'',stages:[{id:'line',name:'LINE',action:'',metric:'登録',url:''},{id:'meeting',name:'面談',action:'',metric:'参加',url:''}]};
const business={...emptyBusiness,version:1,projects:[{id:'p1',name:'案件A',product:'',objective:''}],funnels:[funnel]};
const input:FactInput={source:'検証用',externalId:'1',date:'2026-09-01',collectedAt:'2026-09-09',projectId:'p1',funnelId:'f1',sourceType:'sns',platform:'X',content:'投稿1',angle:'課題',format:'文章',definition:'日別・日本円・重複計上なし',values:{cost:100,revenue:500,payments:null,refunds:0,registrations:20,sales:2},stageCounts:{line:20,meeting:2}};
const fact=(patch:Partial<Fact>={}):Fact=>({...input,id:'id1',funnel,...patch});
test('未取得と0を分け、割合は分子分母の合計から求める',()=>{
 const rows=[fact(),fact({values:{...input.values,cost:900,sales:3}})];
 assert.equal(total(rows,'payments').value,null);assert.equal(total(rows,'refunds').value,0);assert.equal(ratio(rows,'cost','sales'),200);
 assert.equal(ratio([fact({values:{...input.values,sales:0}})],'cost','sales'),null);
 assert.equal(ratio([fact({values:{...input.values,cost:null}})],'cost','sales'),null);
 assert.equal(delta(total(rows,'cost'),total([fact({values:{...input.values,cost:null}})],'cost')),null);
});
test('案件・ファネル・段階の誤対応、不正な日付と数値を拒否',()=>{
 assert.deepEqual(validateFact(input,business),input);
 for(const patch of [{projectId:'other'},{funnelId:'other'},{sourceType:'ads'},{date:'2026-02-30'},{collectedAt:'2026-08-01'},{stageCounts:{unknown:2}},{values:{...input.values,sales:1.5}},{values:{...input.values,cost:-1}}])assert.throws(()=>validateFact({...input,...patch},business));
 assert.equal(validDate('2026-02-30'),false);
 assert.deepEqual(previousPeriod('2026-03-01','2026-03-07'),{start:'2026-02-22',end:'2026-02-28'});
});
test('CSVの引用符・改行・BOMと空欄を扱い、列の欠損を拒否',()=>{
 assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n1,"2\n3",4'),[['a','b,c','d"e'],['1','2\n3','4']]);
 const flat={...input,...input.values,stageCounts:JSON.stringify(input.stageCounts)};
 const encode=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
 const csv='\uFEFF'+columns.join(',')+'\n'+columns.map(k=>encode(flat[k as keyof typeof flat])).join(',');
 const imported=importCsv(csv);assert.deepEqual(validateFact(imported[0],business),input);
 assert.throws(()=>importCsv(columns.join(',')+'\n1,2'));assert.throws(()=>parseCsv('"open'));
});
function environment(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_initial.sql','0002_analytics.sql','0003_businesses_native.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO documents(id,version,data,last_request) VALUES(?,1,?,?)').run('business',JSON.stringify(business),'initial');
 class Query implements Statement {args:unknown[]=[];sql:string;constructor(sql:string){this.sql=sql;}bind(...args:unknown[]){this.args=args;return this;}async first<T>(){return(sqlite.prepare(this.sql).get(...this.args as [])??null) as T|null;}async all<T>(){return{results:sqlite.prepare(this.sql).all(...this.args as []) as T[]};}execute(){return sqlite.prepare(this.sql).run(...this.args as []);}async run(){return{meta:{changes:Number(this.execute().changes)}};}}
 const env={DB:{prepare:(sql:string)=>new Query(sql),batch:async(statements:Statement[])=>{sqlite.exec('BEGIN');try{const values=statements.map(s=>(s as Query).execute());sqlite.exec('COMMIT');return values;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}} as Env;
 const post=(body:unknown)=>analytics(new Request('https://test/api/marketing/analytics',{method:'POST',body:JSON.stringify(body)}),env);
 const get=()=>analytics(new Request('https://test/api/marketing/analytics?start=2026-09-01&end=2026-09-30'),env);
 return{sqlite,post,get,env};
}
test('実DBでプレビュー非保存・再送・重複拒否・取込時の定義保持を検証',async()=>{
 const {sqlite,post,get}=environment();try{
 const b={action:'preview',requestId:'req1',rows:[input]};const p=await post(b);assert.equal(p.status,200);assert.equal((await(await get()).json()).rows.length,0);
 const preview=await p.json();const imported={...b,action:'import',businessVersion:preview.businessVersion};assert.equal((await post(imported)).status,200);
 assert.equal((await(await post(imported)).json()).replayed,true);
 assert.equal((await post({...imported,requestId:'req2'})).status,409);
 assert.equal((await post({...imported,rows:[{...input,externalId:'different'}]})).status,409);
 sqlite.prepare('UPDATE documents SET version=2,data=? WHERE id=?').run(JSON.stringify({...business,version:2,funnels:[{...funnel,name:'編集後',stages:[]}]}),'business');
 const stored=(await(await get()).json()).rows;assert.equal(stored.length,1);assert.equal(stored[0].funnel.name,'相談へ');assert.equal(stored[0].funnel.stages.length,2);
 }finally{sqlite.close();}
});
test('複数行の途中の不正と古い設定での取込は一部だけ保存しない',async()=>{
 const {sqlite,post,get}=environment();try{
 const b={action:'import',requestId:'req3',businessVersion:1,rows:[input,{...input,externalId:'2',stageCounts:{unknown:1}}]};assert.equal((await post(b)).status,400);assert.equal((await(await get()).json()).rows.length,0);
 assert.equal((await post({...b,rows:[input],businessVersion:0})).status,409);assert.equal((await(await get()).json()).rows.length,0);
 }finally{sqlite.close();}
});

test('事業ごとに同じ元データIDを登録でき、実績と再送結果が混ざらない',async()=>{
 const {sqlite,post,env}=environment();try{
 sqlite.exec("INSERT INTO businesses VALUES('second','別の事業','2026-09-10')");
 sqlite.prepare('INSERT INTO documents(id,version,data,last_request) VALUES(?,1,?,?)').run('second:business',JSON.stringify(business),'init');
 const body={action:'import',requestId:'same',businessVersion:1,rows:[input]};
 assert.equal((await post(body)).status,200);
 const req=new Request('https://test/api',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await analytics(req,env,'second')).status,200);
 for(const scope of ['default','second']){const r=await analytics(new Request('https://test/api'),env,scope);assert.equal((await r.json()).rows.length,1);}
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM analytics_rows').get()!.n,2);
 const forged=await post({...body,requestId:'second:same',rows:[{...input,externalId:'new'}]});
 assert.equal(forged.status,409);assert.equal((await forged.json()).replayed,undefined);
 }finally{sqlite.close();}
});
