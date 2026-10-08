import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {agentSkills} from '../cloud/agent-skills.ts';
import {emptySkills,validateSkill,missingSkillReferences,safeResourcePath,type AgentSkill} from '../lib/autonomy/skills.ts';
import {performTool} from '../cloud/autonomy-tools.ts';
import {settings} from '../cloud/autonomy-store.ts';
import {tick} from '../cloud/autonomy-engine.ts';
import {autonomy} from '../cloud/autonomy.ts';
import {campaignState,type BoardAction} from '../lib/autonomy/board.ts';
import {emptyState,type Improvement} from '../lib/improvements/model.ts';
import {defaultPolicy} from '../lib/autonomy/model.ts';
import {emptyBusiness} from '../lib/marketing-business/types.ts';
import {digest} from '../cloud/storage.ts';
import type {Env,Statement} from '../cloud/types.ts';
const owner={id:'owner',companyId:'company',name:'所有者',email:'test@example.test',role:'owner' as const,version:1,grants:[]};
function fixture(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.exec("INSERT INTO users(id,company_id,email,name,password_hash,role,created_at) VALUES('owner','company','test@example.test','所有者','unused','owner','2026-01-01')");
 db.prepare('INSERT INTO autonomy_settings(business_id,owner_id,version,policy,next_at,updated_at) VALUES(?,?,?,?,?,?)').run('default','owner',1,JSON.stringify({...defaultPolicy,enabled:true,purpose:'実績を調べて投稿を改善する',internal:['create_post_draft']}),0,'2026-01-01');
 db.prepare("INSERT INTO documents VALUES('business',1,?,'')").run(JSON.stringify({...emptyBusiness,version:1,goals:[{id:'g',title:'成約数',metric:'conversions',baseline:0,target:10,direction:'increase',deadline:'2026-12-31',owner:'担当',baselineDays:14,baselineSource:'記録',comparisonConfirmed:false}]}));
 class Q implements Statement{args:unknown[]=[];sql:string;constructor(sql:string){this.sql=sql;}bind(...a:unknown[]){this.args=a;return this;}async first<T>(){return db.prepare(this.sql).get(...this.args as []) as T??null;}async all<T>(){return{results:db.prepare(this.sql).all(...this.args as []) as T[]};}async run(){return{meta:{changes:Number(db.prepare(this.sql).run(...this.args as []).changes)}};}}
 const env={ASTRA_MODEL:'test-model',ASTRA_OPENAI_KEY:'fake-key',ASTRA_LOOP:{getByName:()=>({wake:async()=>{}})},DB:{prepare:(s:string)=>new Q(s),batch:async(ss:Statement[])=>{db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}} as Env;
 return{db,env,job:()=>db.prepare('SELECT * FROM autonomy_jobs ORDER BY created_at DESC LIMIT 1').get()!};}
function mock(sequence:((input:any[])=>any[])[]){const previous=globalThis.fetch;let n=0;globalThis.fetch=async(_url,init)=>{const b=JSON.parse(String(init?.body));assert.equal(b.store,false);assert.deepEqual(b.include,['reasoning.encrypted_content']);return Response.json({status:'completed',output:sequence[n++](b.input),usage:{total_tokens:10}});};return{restore:()=>globalThis.fetch=previous,count:()=>n};}
const call=(name:string,args:object)=>[{type:'function_call',call_id:crypto.randomUUID(),name,arguments:JSON.stringify({arguments_json:JSON.stringify(args)})}];
const final=[{type:'message',content:[{type:'output_text',text:'下書きを作成しました。公開後の実績を確認します。'}]}];
test('モデルが調査→改善案→許可済み下書き→次回観測を選び、永続化して二重作成しない',async()=>{const x=fixture();let caseId='';const m=mock([()=>call('read_business',{}),()=>call('create_improvement',{title:'説明を具体化',goalId:'g',funnelId:'',hypothesis:'説明不足',before:'旧文',after:'新しい投稿本文',operation:'create_post_draft',platform:'x',owner:'担当',due:'2026-12-31',stopRule:'問題時に停止',evidence:{start:'2026-01-01',end:'2026-01-31',source:'仮説',description:'実績未取得のため仮説'}}),input=>{caseId=JSON.parse(input.at(-1).output).caseId;assert.ok(caseId);return call('prepare_improvement',{caseId});},()=>final]);try{for(let i=0;i<7;i++)await tick(x.env,'default');assert.equal(x.job().status,'waiting');const drafts=JSON.parse(x.db.prepare("SELECT data FROM documents WHERE id='drafts'").get()!.data as string);assert.equal(drafts.length,1);assert.equal(drafts[0].reviewState,'editing');assert.deepEqual(drafts[0].remotePostIds,[]);assert.ok(Number(x.db.prepare('SELECT next_at FROM autonomy_settings').get()!.next_at)>Date.now());await tick(x.env,'default');assert.equal(m.count(),4);}finally{m.restore();x.db.close();}});
test('応答台帳の保存後に中断してもモデルを再呼出しせず、途中応答が不明なら停止する',async()=>{for(const status of ['done','started']){const x=fixture(),m=mock([()=>call('read_business',{})]);try{await tick(x.env,'default');const j=x.job(),d=JSON.parse(j.data as string);d.pending=[];d.steps=0;d.calls=0;d.input=d.input.slice(0,1);x.db.prepare('UPDATE autonomy_jobs SET data=?').run(JSON.stringify(d));x.db.prepare('UPDATE autonomy_actions SET status=?').run(status);await tick(x.env,'default');assert.equal(m.count(),1);assert.equal(x.job().status,status==='started'?'needs_input':'running');}finally{m.restore();x.db.close();}}});
test('利用者の停止と設定変更は保留中の操作に反映し、APIで秘密・内部入力を返さない',async()=>{const x=fixture(),m=mock([()=>call('read_business',{})]);try{await tick(x.env,'default');x.db.prepare('UPDATE autonomy_settings SET version=2').run();await tick(x.env,'default');assert.equal(x.job().status,'cancelled');const view=await(await autonomy(new Request('https://test/'),x.env,owner,'default')).text();assert.ok(!view.includes('fake-key'));assert.ok(!view.includes('"input"'));const member={...owner,role:'member' as const,grants:[{businessId:'default',page:'autonomy' as const,edit:true,projects:null}]};assert.equal((await autonomy(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'stop'})}),x.env,member,'default')).status,403);await autonomy(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'stop'})}),x.env,owner,'default');assert.equal(await tick(x.env,'default'),null);assert.equal(m.count(),1);}finally{m.restore();x.db.close();}});
test('追加判断が必要なら次回予約を止め、利用上限でも継続課金しない',async()=>{for(const mode of ['question','limit']){const x=fixture(),m=mock([()=>call(mode==='question'?'request_input':'read_business',mode==='question'?{question:'商品の対象を教えてください。'}:{})]);try{if(mode==='limit')x.db.prepare('UPDATE autonomy_settings SET policy=?').run(JSON.stringify({...defaultPolicy,enabled:true,purpose:'調査',maxModelCalls:1}));await tick(x.env,'default');await tick(x.env,'default');await tick(x.env,'default');assert.equal(x.job().status,'needs_input');assert.equal(x.db.prepare('SELECT next_at FROM autonomy_settings').get()!.next_at,null);assert.equal(m.count(),1);}finally{m.restore();x.db.close();}}});

test('campaign stages distinguish drafts, uncertain actions, observation and human decisions',()=>{
 const action:BoardAction={id:'a',jobId:'j',name:'prepare_improvement',status:'done',at:'',issue:'',message:'',jobStatus:'waiting',question:'',nextAt:null};
 assert.equal(campaignState('prepared',action,true),'draft');
 assert.equal(campaignState('observing',action,true),'observing');
 assert.equal(campaignState('review',action,true),'decision');
 assert.equal(campaignState('prepared',{...action,status:'started',jobStatus:'running'},true),'running');
 assert.equal(campaignState('prepared',{...action,status:'started',jobStatus:'running'},false),'attention');
 assert.equal(campaignState('prepared',{...action,status:'started',jobStatus:'cancelled'},true),'attention');
 assert.equal(campaignState('prepared',{...action,issue:'API rejected'},true),'attention');
 assert.equal(campaignState('prepared',{...action,jobStatus:'needs_input'},true),'decision');
 assert.equal(campaignState('closed',{...action,issue:'old failure'},true),'completed');
});
test('board retains old linked campaigns, separates business knowledge and never exposes prepared input',async()=>{
 const x=fixture();try{
  const c:Improvement={id:'case-one',title:'説明を改善',goalId:'g',funnelId:'',hypothesis:'仮説',before:'旧',after:'新',operation:'create_post_draft',platform:'x',phase:'prepared',owner:'担当',due:'2026-12-31',stopRule:'問題時',evidence:{start:'2026-01-01',end:'2026-01-31',source:'一次資料',description:'調査',factIds:[],digest:''},result:'pending',resultNote:'',resultSource:'',feedback:'',rejectionReason:'',createdAt:'2026-01-01',updatedAt:'2026-01-02'};
  x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('improvements',JSON.stringify({...emptyState,cases:[c,{...c,id:'manual-only'}],knowledge:[{id:'k',title:'商品資料',content:'自社の商品情報',source:'商品仕様書',updatedAt:'2026-01-01'}]}),'');
  x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('two:improvements',JSON.stringify({...emptyState,knowledge:[{id:'secret',title:'他事業の資料',content:'hidden-business-knowledge',source:'',updatedAt:''}]}),'');
  const job={summary:'調査',question:'',nextAt:null,steps:1,calls:1,tokens:1,model:'test-model',input:['private-model-input'],pending:[]};
  for(let i=0;i<35;i++)x.db.prepare('INSERT INTO autonomy_jobs VALUES(?,?,?,?,?,?,?)').run('job-'+i,'default','waiting',1,JSON.stringify(job),'2026-01-'+String(i+1).padStart(2,'0'),'2026-02-01');
  x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('action','job-0','prepare_improvement','done',JSON.stringify({body:{caseId:'case-one',privateToken:'never-show-prepared'},endpoint:'improvements'}),JSON.stringify({caseId:'case-one',lastOperation:{status:'failed',output:'下書きの作成に失敗'}}),'2026-01-01','2026-01-02');
  const member={...owner,role:'member' as const,grants:[{businessId:'default',page:'autonomy' as const,edit:false,projects:null}]};
  const r=await autonomy(new Request('https://test/?view=board'),x.env,member,'default');assert.equal(r.status,200);const raw=await r.text(),b=JSON.parse(raw);
  assert.equal(b.campaigns.length,1);assert.equal(b.campaigns[0].goal,'成約数');assert.equal(b.campaigns[0].state,'attention');assert.equal(b.campaigns[0].actionCount,1);assert.equal(b.knowledge[0].content,'自社の商品情報');assert.equal(b.dotConnected,false);
  for(const forbidden of ['private-model-input','never-show-prepared','hidden-business-knowledge','fake-key'])assert.ok(!raw.includes(forbidden));
  assert.equal((await autonomy(new Request('https://test/?view=board'),x.env,member,'two')).status,403);
  x.db.prepare('UPDATE autonomy_actions SET result=?').run(JSON.stringify({caseId:'case-one',lastOperation:{status:'success',output:'下書き作成'}}));
  const next=await(await autonomy(new Request('https://test/?view=board'),x.env,owner,'default')).json();assert.equal(next.campaigns[0].state,'draft');
  for(const result of [{status:'uncertain',message:'反映不明'},{needsAcknowledgement:true,message:'人による確認が必要'}]){
   x.db.prepare('UPDATE autonomy_actions SET name=?,result=?').run('execute_ad_change',JSON.stringify(result));
   const v=await(await autonomy(new Request('https://test/?view=board'),x.env,owner,'default')).json();assert.equal(v.campaigns[0].state,'attention');
  }
 }finally{x.db.close();}
});

test('knowledge tool reads only the registered catalog or selected document in its business',async()=>{
 const x=fixture();try{
  x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('improvements',JSON.stringify({...emptyState,knowledge:[{id:'k',title:'商品仕様',content:'参照する本文',source:'仕様書',updatedAt:'2026-01-01'}]}),'');
  x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('two:improvements',JSON.stringify({...emptyState,knowledge:[{id:'other',title:'他事業',content:'他事業の本文',source:'',updatedAt:''}]}),'');
  const s=(await settings(x.env,'default'))!;
  const catalog=await performTool(x.env,s,'job','action','read_knowledge',{});
  assert.deepEqual(catalog,[{id:'k',title:'商品仕様',source:'仕様書'}]);
  assert.equal((await performTool(x.env,s,'job','action','read_knowledge',{id:'k'})).content,'参照する本文');
  assert.deepEqual(await performTool(x.env,s,'job','action','read_knowledge',{id:'other'}),{error:'資料がありません。'});
 }finally{x.db.close();}
});

const sampleSkill:AgentSkill={id:'query-guide',name:'検索語句分析',description:'広告データの比較を検証する',instructions:'指標の定義を確認。[資料](references/check.md)',resources:[{path:'references/check.md',content:'欠測をゼロに置き換えない。'}],source:'query-guide/SKILL.md',enabled:true,reviewed:true,revision:'',updatedAt:''};
test('skill registration is scoped, owner managed, versioned and rejects unsafe package paths',async()=>{
 const x=fixture();try{
  const save=(skill:AgentSkill,version=0)=>agentSkills(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'save',skill,expectedVersion:version,requestId:crypto.randomUUID()})}),x.env,owner,'default');
  assert.equal((await save({...sampleSkill,reviewed:false})).status,400);
  assert.equal((await save({...sampleSkill,resources:[]})).status,400);
  const first=await save(sampleSkill);assert.equal(first.status,200);const data=await first.json();assert.ok(data.skills[0].revision);assert.equal(data.skills[0].instructions,undefined);assert.deepEqual(data.skills[0].missingReferences,[]);
  assert.equal((await save({...sampleSkill,name:'古い画面から変更'})).status,409);
  const view=await(await agentSkills(new Request('https://test/?id=query-guide'),x.env,owner,'default')).json();assert.equal(view.skill.resources[0].content,'欠測をゼロに置き換えない。');
  const member={...owner,role:'member' as const,grants:[{businessId:'default',page:'autonomy' as const,edit:true,projects:null}]};
  assert.equal((await agentSkills(new Request('https://test/'),x.env,member,'two')).status,403);
  assert.equal((await agentSkills(new Request('https://test/',{method:'POST',body:'{}'}),x.env,member,'default')).status,403);
  assert.equal((await(await agentSkills(new Request('https://test/'),x.env,owner,'two')).json()).skills.length,0);
  for(const path of ['../secret','/etc/passwd','refs/../../secret','refs\\secret'])assert.equal(safeResourcePath(path),false);
  assert.equal(safeResourcePath('references/確認.md'),true);
  assert.throws(()=>validateSkill({...sampleSkill,resources:[{path:'../secret',content:'bad'}]}));
  assert.deepEqual(missingSkillReferences({...sampleSkill,instructions:'[missing](../private.md) [ok](references/check.md) [web](https://example.test)'}),['../private.md']);
 }finally{x.db.close();}
});
test('skill tools require real reads, current revisions and an existing campaign before reporting use',async()=>{
 const x=fixture();try{
  const save=await agentSkills(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'save',skill:sampleSkill,expectedVersion:0,requestId:'save-skill'})}),x.env,owner,'default');assert.equal(save.status,200);
  const s=(await settings(x.env,'default'))!,call=(name:string,args:unknown)=>performTool(x.env,s,'skill-job','usage',name,args);
  const catalog=await call('read_skills',{});assert.equal(catalog[0].id,'query-guide');assert.equal(catalog[0].instructions,undefined);
  const skill=await call('read_skill',{id:'query-guide'});assert.equal(skill.instructions,sampleSkill.instructions);assert.deepEqual(skill.requiredKnowledge,sampleSkill.resources);
  await assert.rejects(call('read_skill_resource',{id:'query-guide',revision:skill.revision,path:'references/check.md'}),/本文を読んで/);
  x.db.prepare('INSERT INTO autonomy_jobs VALUES(?,?,?,?,?,?,?)').run('skill-job','default','running',1,JSON.stringify({summary:'調査',question:'',nextAt:null}),'2026-01-01','2026-01-01');
  x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('read','skill-job','read_skill','done','',JSON.stringify({...skill,requiredKnowledge:[]}),'2026-01-01','2026-01-01');
  x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('usage','skill-job','record_skill_usage','started','','','2026-01-01','2026-01-01');
  assert.equal((await call('read_skill_resource',{id:'query-guide',revision:skill.revision,path:'references/check.md'})).content,sampleSkill.resources[0].content);
  await assert.rejects(call('read_skill_resource',{id:'query-guide',revision:'old',path:'references/check.md'}),/更新/);
  await assert.rejects(call('read_skill_resource',{id:'query-guide',revision:skill.revision,path:'missing.md'}),/未登録/);
  await assert.rejects(call('record_skill_usage',{id:'query-guide',revision:skill.revision,caseId:'other-business-case',application:'反映した'}),/案件/);
  x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('improvements',JSON.stringify({...emptyState,cases:[{id:'case',title:'検証',goalId:'g',funnelId:'',phase:'draft',operation:'record_campaign',updatedAt:'2026-01-01'}]}),'');
  await assert.rejects(call('record_skill_usage',{id:'query-guide',revision:skill.revision,caseId:'case',application:'反映した'}),/必須ナレッジ/);
  await assert.rejects(call('create_improvement',{}),/必須ナレッジ/);
  x.db.prepare("UPDATE autonomy_actions SET result=? WHERE id='read'").run(JSON.stringify(skill));
  const prefetchedReport=await call('record_skill_usage',{id:'query-guide',revision:skill.revision,caseId:'case',application:'本文と必須ナレッジをまとめて取得し欠測の扱いを反映した'});assert.deepEqual(prefetchedReport.resourcesRead,['references/check.md']);
  x.db.prepare("UPDATE autonomy_actions SET result=? WHERE id='read'").run(JSON.stringify({...skill,requiredKnowledge:[]}));
  const resource=await call('read_skill_resource',{id:'query-guide',revision:skill.revision,path:'references/check.md'});
  x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('resource','skill-job','read_skill_resource','done','',JSON.stringify(resource),'2026-01-01','2026-01-01');
  const report=await call('record_skill_usage',{id:'query-guide',revision:skill.revision,caseId:'case',application:'欠測を除外して比較条件を明記した'});assert.equal(report.reported,true);
  x.db.prepare('UPDATE autonomy_actions SET status=?,result=? WHERE id=?').run('done',JSON.stringify(report),'usage');
  const board=await(await autonomy(new Request('https://test/?view=board'),x.env,owner,'default')).json();assert.equal(board.campaigns[0].actions[0].skill.name,'検索語句分析');assert.equal(board.campaigns[0].state,'draft');
  await agentSkills(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'save',skill:{...sampleSkill,enabled:false},expectedVersion:1,requestId:'disable-skill'})}),x.env,owner,'default');
  await assert.rejects(call('read_skill',{id:'query-guide'}),/無効/);
  assert.deepEqual(await call('read_skills',{}),[]);
 }finally{x.db.close();}
});

test('selected conditional Knowledge is read at the current revision; unselected documents are not required',async()=>{
 const x=fixture();try{
 const candidate={...sampleSkill,readingMode:'selective' as const,requiredResources:['references/check.md'],resources:[...sampleSkill.resources,{path:'Knowledge/one.md',content:'a'.repeat(39000),trigger:'Demand research'},{path:'Knowledge/two.md',content:'b'.repeat(39000),trigger:'Concept analysis'}]};
 const save=await agentSkills(new Request('https://test/',{method:'POST',body:JSON.stringify({action:'save',skill:candidate,expectedVersion:0,requestId:'selective-save'})}),x.env,owner,'default');assert.equal(save.status,200);
 const s=(await settings(x.env,'default'))!,call=(name:string,args:unknown)=>performTool(x.env,s,'selective-job','selective-usage',name,args);
 const core=await call('read_skill',{id:'query-guide'});assert.deepEqual(core.requiredResources,['references/check.md']);assert.equal(core.requiredKnowledge.length,1);assert.equal(core.resourceCatalog.find(r=>r.path==='Knowledge/two.md').trigger,'Concept analysis');
 await assert.rejects(call('read_skill',{id:'query-guide',paths:['../private.md']}),/登録済み/);
 const selected=await call('read_skill',{id:'query-guide',paths:['Knowledge/one.md','Knowledge/two.md']});assert.deepEqual(selected.remainingRequiredResources,['Knowledge/two.md']);
 x.db.prepare('INSERT INTO autonomy_jobs VALUES(?,?,?,?,?,?,?)').run('selective-job','default','running',1,JSON.stringify({summary:'調査',question:'',nextAt:null}),'2026-01-01','2026-01-01');
 x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('selective-read','selective-job','read_skill','done','',JSON.stringify(selected),'2026-01-01','2026-01-01');
 x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('selective-usage','selective-job','record_skill_usage','started','','','2026-01-01','2026-01-01');
 x.db.prepare('INSERT INTO documents VALUES(?,1,?,?)').run('improvements',JSON.stringify({...emptyState,cases:[{id:'case',title:'検証',goalId:'g',funnelId:'',phase:'draft',operation:'record_campaign',updatedAt:'2026-01-01'}]}),'');
 await assert.rejects(call('record_skill_usage',{id:'query-guide',revision:selected.revision,caseId:'case',application:'反映した'}),/必須ナレッジ/);await assert.rejects(call('create_improvement',{}),/必須ナレッジ/);
 const resource=await call('read_skill_resource',{id:'query-guide',revision:selected.revision,path:'Knowledge/two.md'});x.db.prepare('INSERT INTO autonomy_actions VALUES(?,?,?,?,?,?,?,?)').run('conditional-read','selective-job','read_skill_resource','done','',JSON.stringify({...resource,revision:'old'}),'2026-01-01','2026-01-01');
 await assert.rejects(call('record_skill_usage',{id:'query-guide',revision:selected.revision,caseId:'case',application:'反映した'}),/必須ナレッジ/);
 x.db.prepare("UPDATE autonomy_actions SET result=? WHERE id='conditional-read'").run(JSON.stringify(resource));const report=await call('record_skill_usage',{id:'query-guide',revision:selected.revision,caseId:'case',application:'選択した需要資料とコンセプト資料を反映した'});assert.deepEqual(report.resourcesRead.sort(),['Knowledge/one.md','Knowledge/two.md','references/check.md']);
 }finally{x.db.close();}
});
