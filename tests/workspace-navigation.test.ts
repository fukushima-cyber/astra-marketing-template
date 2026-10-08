import test from 'node:test';
import assert from 'node:assert/strict';
import {canOpenPanel,readWorkspaceRoute,workspaceUrl,workspaceGroups,groupsForChannels,panelEnabledForChannels,channelAnalysisPanels,availableConnectionTabs} from '../lib/workspace-navigation.ts';
import {makeAnalysisHandoff,parseHandoff,safeAnalysisPath} from '../lib/analysis-handoff.ts';
import {selectedPreset,presetRange} from '../lib/date-range.ts';
import type {Identity} from '../lib/access.ts';
import type {Fact} from '../lib/analytics/model.ts';
const owner:Identity={id:'u',companyId:'c',name:'Owner',email:'local@example.test',role:'owner',version:0,grants:[]};
const member:Identity={...owner,role:'member',grants:[{businessId:'one',page:'analytics',edit:false,projects:null}]};
const allowed=(p:string)=>canOpenPanel(owner,'one',p);
test('legacy settings URLs reach editors moved into planning and data',()=>{
 for(const section of ['funnels','goal-settings','observations','connections']){
  const old=new URL('https://example.test/marketing?businessId=one&panel=settings&section='+section);
  const route=readWorkspaceRoute(old,allowed);assert.equal(route.panel,section);
  assert.equal(workspaceUrl(old,route.panel!).searchParams.get('section'),null);
 }
 assert.equal(readWorkspaceRoute(new URL('https://example.test/marketing?panel=goals'),allowed).panel,'okr');
});
test('navigation preserves analysis scope and removes unrelated record selection',()=>{
 const before=new URL('https://example.test/marketing?businessId=one&kind=content&start=2026-09-01&end=2026-09-20&projectId=p&platform=instagram&analysisView=cross&axis=platform&campaign=old&handoff=old');
 const after=workspaceUrl(before,'tasks',{campaign:'chosen'});
 for(const key of ['businessId','kind','start','end','projectId','platform','analysisView','axis'])assert.equal(after.searchParams.get(key),before.searchParams.get(key));
 assert.equal(after.searchParams.get('campaign'),'chosen');assert.equal(after.searchParams.get('handoff'),null);
 assert.equal(before.searchParams.get('campaign'),'old');
});
test('menu and deep links respect read, edit, and business boundaries',()=>{
 assert.equal(canOpenPanel(member,'one','analytics'),true);assert.equal(canOpenPanel(member,'one','import'),false);
 assert.equal(canOpenPanel(member,'one','tasks'),false);assert.equal(canOpenPanel(member,'two','analytics'),false);
 assert.equal(readWorkspaceRoute(new URL('https://example.test/marketing?panel=tasks'),p=>canOpenPanel(member,'one',p)).panel,'dashboard');
 assert.equal(readWorkspaceRoute(new URL('https://example.test/marketing'),p=>canOpenPanel(member,'two',p)).panel,null);
 const panels=workspaceGroups.flatMap(g=>g.panels);assert.equal(new Set(panels).size,panels.length);
});
test('analysis handoff retains missingness and rejects other business or external links',()=>{
 const rows=[{id:'r',source:'fixture',definition:'注文台帳',values:{revenue:300,cost:null}}] as Fact[];
 const handoff=makeAnalysisHandoff({id:'h',businessId:'one',title:'売上の明細',rows,filter:{start:'2026-09-01',end:'2026-09-20',projectId:'p',funnelId:'f',sourceType:'ads',platform:'meta'},url:new URL('https://example.test/marketing?kind=content&axis=platform'),createdAt:'2026-10-01T00:00:00Z'});
 assert.match(handoff.source,/費用：未取得/);assert.match(handoff.source,/1記録が未取得/);assert.match(handoff.returnPath,/platform=meta/);
 assert.equal(parseHandoff(JSON.stringify(handoff),'one','h')?.id,'h');
 assert.equal(parseHandoff(JSON.stringify(handoff),'two','h'),null);
 for(const path of ['https://evil.test/marketing?panel=analytics&businessId=one','//evil.test/marketing','/marketing?businessId=two&panel=analytics','javascript:alert(1)'])assert.equal(safeAnalysisPath(path,'one'),null);
 assert.equal(parseHandoff('{broken','one','h'),null);
});
test('overlapping date presets have exactly one selection, keeping explicit choice',()=>{
 const date='2026-01-01',range=presetRange('day',date);
 assert.equal(selectedPreset(range,date),'month');assert.equal(selectedPreset(range,date,'day'),'day');
 assert.equal(selectedPreset(range,date,'custom'),null);
});


test('channel navigation contains only selected features and keeps execution shared',()=>{
 const common=groupsForChannels([]);
 assert.deepEqual(common.find(g=>g.name==='施策と実行')?.panels,['work','tasks','whiteboard','autonomy']);
 assert.ok(!common.flatMap(g=>g.panels).includes('ads'));
 assert.ok(!common.flatMap(g=>g.panels).includes('posts'));
 const selected=groupsForChannels(['seo','sns','seo']);
 assert.deepEqual(selected.filter(g=>['SEO','SNS','広告'].includes(g.name)).map(g=>g.name),['SEO','SNS']);
 const panels=selected.flatMap(g=>g.panels);assert.equal(new Set(panels).size,panels.length);
 assert.ok(panels.includes('seo-analysis'));assert.ok(panels.includes('posts'));assert.ok(!panels.includes('ads-settings'));
 for(const [panel,channel] of Object.entries(channelAnalysisPanels)){
  assert.equal(canOpenPanel(owner,'one',panel,[channel]),true);
  assert.equal(canOpenPanel(owner,'one',panel,[]),false);
 }
});
test('channel settings do not grant permission, and deep links fall back after deselection',()=>{
 const adsMember:Identity={...member,grants:[{businessId:'one',page:'ads',edit:false,projects:null}]};
 assert.equal(canOpenPanel(adsMember,'one','ads',['ads']),true);
 assert.equal(canOpenPanel(adsMember,'one','ads',['seo']),false);
 assert.equal(canOpenPanel(member,'one','ads',['ads']),false);
 assert.equal(canOpenPanel(member,'two','seo-analysis',['seo']),false);
 const url=new URL('https://example.test/marketing?businessId=one&panel=ads');
 assert.equal(readWorkspaceRoute(url,p=>canOpenPanel(adsMember,'one',p,['ads'])).panel,'ads');
 assert.equal(readWorkspaceRoute(url,p=>canOpenPanel(owner,'one',p,['seo'])).panel,'dashboard');
 assert.equal(readWorkspaceRoute(url,p=>canOpenPanel(adsMember,'one',p,[])).panel,null);
 const legacy=new URL('https://example.test/marketing?panel=settings&section=ads-settings');
 assert.equal(readWorkspaceRoute(legacy,p=>canOpenPanel(owner,'one',p,['seo'])).panel,'autonomy-settings');
});
test('switching channel analytics clears incompatible filters but keeps dates and project',()=>{
 const before=new URL('https://example.test/marketing?businessId=one&panel=sns-analysis&sourceType=sns&platform=instagram&funnelId=social&start=2026-09-01&projectId=p');
 const seo=workspaceUrl(before,'seo-analysis');
 assert.equal(seo.searchParams.get('sourceType'),'seo');
 assert.equal(seo.searchParams.get('platform'),null);assert.equal(seo.searchParams.get('funnelId'),null);
 assert.equal(seo.searchParams.get('start'),'2026-09-01');assert.equal(seo.searchParams.get('projectId'),'p');
 const all=workspaceUrl(seo,'analytics');assert.equal(all.searchParams.get('sourceType'),null);
 assert.equal(before.searchParams.get('sourceType'),'sns');
});

test('agent workspace is shared across channels without broadening business permissions',()=>{
 const agent:Identity={...member,grants:[{businessId:'one',page:'autonomy',edit:false,projects:null}]};
 for(const channels of [[],['seo'],['email']] as const){
  assert.equal(canOpenPanel(agent,'one','autonomy',channels),true);
  assert.equal(canOpenPanel(agent,'one','autonomy-settings',channels),true);
  assert.equal(canOpenPanel(agent,'two','autonomy',channels),false);
  assert.equal(canOpenPanel(member,'one','autonomy',channels),false);
 }
});

test('UTAGE LP connection and measurement are shared even for ads-only businesses',()=>{
 const panels=groupsForChannels(['ads']).flatMap(g=>g.panels);
 assert.equal(panels.filter(p=>p==='connections').length,1);assert.equal(panels.filter(p=>p==='email-connections').length,0);assert.equal(panels.filter(p=>p==='measurement').length,0);
 assert.ok(panelEnabledForChannels('email-connections',['seo']));
});


test('knowledge has a dedicated authorized entry and channel analysis is adjacent to analysis',()=>{
 assert.equal(readWorkspaceRoute(new URL('https://example.test/marketing?panel=knowledge'),allowed).panel,'knowledge');
 assert.equal(canOpenPanel(member,'one','knowledge'),false);
 const groups=groupsForChannels(['ads']);assert.ok(groups.findIndex(g=>g.name==='広告')<groups.findIndex(g=>g.name==='案件と目標'));
 assert.deepEqual(groups.find(g=>g.name==='ナレッジ')?.panels,['knowledge']);
 assert.ok(!groups.find(g=>g.name==='施策と実行')?.panels.includes('ads'));
});

test('skill readers can reach knowledge without acquiring document permissions',()=>{
 const reader:Identity={...member,grants:[{businessId:'one',page:'autonomy',edit:false,projects:null}]};
 assert.equal(canOpenPanel(reader,'one','knowledge'),true);assert.equal(canOpenPanel(reader,'one','improvements'),false);assert.equal(canOpenPanel(reader,'two','knowledge'),false);
});


test('connection hub keeps section permissions and legacy URLs',()=>{
 const adsMember:Identity={...member,grants:[{businessId:'one',page:'ads',edit:false,projects:null}]};
 assert.deepEqual(availableConnectionTabs(adsMember,'one',['ads']).map(t=>t.id),['ads','meta']);
 assert.deepEqual(availableConnectionTabs(member,'one',['ads','sns']).map(t=>t.id),['measurement']);
 assert.deepEqual(availableConnectionTabs(adsMember,'two',['ads']),[]);
 for(const [legacy,tab] of Object.entries({'ads-connections':'ads','sns-connections':'sns','email-connections':'utage','measurement':'measurement','ads-settings':'meta'})){
  const url=new URL('https://example.test/marketing?businessId=one&panel='+legacy);
  const route=readWorkspaceRoute(url,p=>canOpenPanel(owner,'one',p,['ads','sns']));
  assert.equal(route.panel,'connections');assert.equal(route.connectionTab,tab);
  const result=workspaceUrl(url,legacy as 'connections');assert.equal(result.searchParams.get('panel'),'connections');assert.equal(result.searchParams.get('connectionTab'),tab);
 }
 assert.ok(!groupsForChannels(['ads','sns','email']).flatMap(g=>g.panels).some(p=>['ads-connections','sns-connections','email-connections','measurement','ads-settings'].includes(p)));
});


test('hub URL selection cannot expose an unauthorized connection section',()=>{
 const native:Identity={...member,grants:[{businessId:'one',page:'connections',edit:false,projects:null}]};
 assert.deepEqual(availableConnectionTabs(native,'one',['ads','sns']).map(t=>t.id),['sns','utage']);
 assert.equal(canOpenPanel(native,'one','ads-connections',['ads','sns']),false);
 assert.equal(canOpenPanel(native,'one','measurement',['ads','sns']),false);
 assert.equal(canOpenPanel(native,'two','connections',['ads','sns']),false);
 const old=new URL('https://example.test/marketing?businessId=one&panel=settings&section=ads-settings');
 const route=readWorkspaceRoute(old,p=>canOpenPanel(owner,'one',p,['ads']));
 assert.equal(route.panel,'connections');assert.equal(route.connectionTab,'meta');
 const general=workspaceUrl(old,'connections',{connectionTab:'utage'});
 assert.equal(general.searchParams.get('section'),null);assert.equal(general.searchParams.get('connectionTab'),'utage');
});

test('商品と売上はチャネルや販売方法を変えても残り、事業全体の権限だけで開く',()=>{
 assert.equal(canOpenPanel(owner,'one','commerce',[]),true);
 assert.equal(canOpenPanel(member,'one','commerce',[]),false);
 const limited:Identity={...member,grants:[{businessId:'one',page:'business',edit:true,projects:['p1']}]};assert.equal(canOpenPanel(limited,'one','commerce',[]),false);
 assert.ok(groupsForChannels(['sns']).flatMap(g=>g.panels).includes('commerce'));
});
