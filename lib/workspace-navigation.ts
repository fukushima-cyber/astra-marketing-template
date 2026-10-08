import {can,permission,type AccessPage,type Identity} from './access.ts';
import {acquisitionChannelNames,type AcquisitionChannel} from './business.ts';

export const workspacePages = {
 'journey-events':{name:'申込・成約',access:'analytics'},
 commerce:{name:'商品・売上',access:'business'},
 history:{name:'変更履歴',access:'business'},
 knowledge:{name:'ナレッジ・スキル',access:'improvements'},
 measurement:{name:'データ取得状況',access:'analytics'},
 dashboard:{name:'ダッシュボード',access:'analytics'},
 analytics:{name:'データ分析',access:'analytics'},
 overview:{name:'アカウント別実績',access:'overview'},
 'seo-analysis':{name:'SEOレポート',access:'analytics'},
 'ads-analysis':{name:'広告レポート',access:'ads'},
 'ads-connections':{name:'広告アカウント接続',access:'ads'},
 'sns-connections':{name:'SNSアカウント接続',access:'connections'},
 'email-connections':{name:'UTAGE接続',access:'connections'},
 'sns-analysis':{name:'SNSレポート',access:'analytics'},
 'email-analysis':{name:'メール・LINEレポート',access:'analytics'},
 'referral-analysis':{name:'紹介レポート',access:'analytics'},
 'direct-analysis':{name:'直接流入レポート',access:'analytics'},
 'other-analysis':{name:'その他の流入レポート',access:'analytics'},
 improvements:{name:'改善案',access:'improvements'},
 okr:{name:'目標管理',access:'okr'},
 funnels:{name:'案件・販売導線',access:'business'},
 'goal-settings':{name:'目標設定',access:'business'},
 observations:{name:'実績記録',access:'business'},
 work:{name:'施策管理',access:'work'},
 tasks:{name:'タスク',access:'work'},
 posts:{name:'SNS投稿',access:'posts'},
 ads:{name:'Meta広告運用',access:'ads'},
 autonomy:{name:'AIエージェント',access:'autonomy'},
 whiteboard:{name:'ホワイトボード',access:'work'},
 import:{name:'データ取込',access:'analytics'},
 connections:{name:'外部サービス連携',access:'connections'},
 settings:{name:'設定',access:'business'},
 'autonomy-settings':{name:'AI設定',access:'autonomy'},
 'ads-settings':{name:'Meta広告設定',access:'ads'},
 'improvement-settings':{name:'AI診断設定',access:'improvements'},
} as const;
export type WorkspacePanel=keyof typeof workspacePages;
export const settingPanels:WorkspacePanel[]=['autonomy-settings','ads-settings','improvement-settings'];
export const workspaceGroups:{name:string;description:string;panels:WorkspacePanel[]}[]=[
 {name:'ホーム',description:'事業の現状と次の対応',panels:['dashboard']},
 {name:'分析',description:'実績と変化の根拠を確認',panels:['analytics','journey-events','overview','improvements']},
 {name:'販売',description:'商品と売上の記録',panels:['commerce']},
 {name:'案件と目標',description:'目標と成果までの導線を設計',panels:['okr','funnels','goal-settings','observations']},
 {name:'施策と実行',description:'担当作業と結果を管理',panels:['work','tasks','whiteboard','autonomy']},
 {name:'ナレッジ',description:'判断に使う資料と既存スキル',panels:['knowledge']},
 {name:'接続と設定',description:'取込、接続、実行範囲',panels:['connections','history','import','autonomy-settings','improvement-settings']},
];
export const channelAnalysisPanels:Partial<Record<WorkspacePanel,AcquisitionChannel>>={
 'seo-analysis':'seo','ads-analysis':'ads','sns-analysis':'sns','email-analysis':'email',
 'referral-analysis':'referral','direct-analysis':'direct','other-analysis':'other',
};
const channelFeatures:Record<AcquisitionChannel,WorkspacePanel[]>={
 seo:['seo-analysis'],ads:['ads-analysis','ads'],
 sns:['sns-analysis','posts'],email:['email-analysis'],referral:['referral-analysis'],
 direct:['direct-analysis'],other:['other-analysis'],
};
export function groupsForChannels(channels:readonly AcquisitionChannel[]=[]){
 const selected=Object.keys(acquisitionChannelNames).filter(c=>channels.includes(c as AcquisitionChannel)) as AcquisitionChannel[];
 const channelGroups=selected.map(c=>({name:acquisitionChannelNames[c],description:acquisitionChannelNames[c]+'の実績と運用',panels:channelFeatures[c]}));
 return [...workspaceGroups.slice(0,2),...channelGroups,...workspaceGroups.slice(2)];
}
export function panelEnabledForChannels(panel:string,channels:readonly AcquisitionChannel[]=[]){
 if(panel==='ads-connections'||panel==='ads-settings')return channels.includes('ads');
 if(panel==='sns-connections')return channels.includes('sns');
 if(panel==='email-connections'||panel==='measurement')return true;
 if(panel==='settings')return true; // Legacy settings URLs resolve to an enabled editor.
 return groupsForChannels(channels).some(g=>g.panels.some(p=>p===panel));
}
export const connectionAliases:Record<string,string>={'ads-connections':'ads','sns-connections':'sns','email-connections':'utage','measurement':'measurement','ads-settings':'meta'};
export const connectionTabs=[{id:'ads',name:'広告',panel:'ads-connections'},{id:'sns',name:'SNS',panel:'sns-connections'},{id:'utage',name:'UTAGE',panel:'email-connections'},{id:'measurement',name:'計測',panel:'measurement'},{id:'meta',name:'Meta操作',panel:'ads-settings'}] as const;
export function availableConnectionTabs(user:Identity,businessId:string,channels:readonly AcquisitionChannel[]){return connectionTabs.filter(t=>canOpenPanel(user,businessId,t.panel,channels));}
const aliases:Record<string,WorkspacePanel>={business:'funnels',goals:'okr',journey:'funnels'};
export function canOpenPanel(user:Identity,businessId:string,p:string,channels?:readonly AcquisitionChannel[]):p is WorkspacePanel{
 if(!Object.hasOwn(workspacePages,p))return false;
 if(channels&&!panelEnabledForChannels(p,channels))return false;
 if(p==='connections')return can(user,businessId,'connections')||can(user,businessId,'analytics')||((!channels||channels.includes('ads'))&&can(user,businessId,'ads'));
 if(p==='commerce')return can(user,businessId,'business')&&permission(user,businessId,'business')?.projects===null;
 if(p==='history')return user.role==='owner';
 if(p==='knowledge')return can(user,businessId,'improvements')||can(user,businessId,'autonomy');
 if(p==='settings')return settingPanels.some(k=>canOpenPanel(user,businessId,k,channels));
 return can(user,businessId,workspacePages[p as WorkspacePanel].access as AccessPage,p==='import')||(['okr','work','tasks'].includes(p)&&can(user,businessId,'business'));
}
export function readWorkspaceRoute(url:URL,allowed:(panel:string)=>boolean){
 const raw=url.searchParams.get('panel')??'dashboard';
 let wanted:string=aliases[raw]??raw;
 // Old settings links remain valid, including editors moved to planning/data.
 if(raw==='settings'){
  const section=url.searchParams.get('section')??'';
  wanted=section!=='settings'&&Object.hasOwn(workspacePages,section)&&allowed(section)?section:settingPanels.find(allowed)??'dashboard';
 }
 const connectionTab=connectionAliases[wanted]??url.searchParams.get('connectionTab')??'';
 if(connectionAliases[wanted]&&allowed(wanted))wanted='connections';
 const panel=(allowed(wanted)?wanted:groupsForChannels(Object.keys(acquisitionChannelNames) as AcquisitionChannel[]).flatMap(g=>g.panels).find(p=>p!=='settings'&&allowed(p))??null) as WorkspacePanel|null;
 return {panel,connectionTab,goal:url.searchParams.get('goal')??'',campaign:url.searchParams.get('campaign')??'',handoff:url.searchParams.get('handoff')??''};
}
export function workspaceUrl(current:URL,panel:WorkspacePanel,params:Record<string,string|undefined>={}){
 const url=new URL(current);
 if(connectionAliases[panel]){params={connectionTab:connectionAliases[panel],...params};panel='connections';}
 url.searchParams.set('panel',settingPanels.includes(panel)?'settings':panel);
 if(settingPanels.includes(panel))url.searchParams.set('section',panel);else url.searchParams.delete('section');
 const channel=channelAnalysisPanels[panel];
 if(channel){url.searchParams.set('sourceType',channel);for(const key of ['funnelId','platform'])url.searchParams.delete(key);}
 else if(panel==='analytics'&&channelAnalysisPanels[current.searchParams.get('panel') as WorkspacePanel]){for(const key of ['sourceType','funnelId','platform'])url.searchParams.delete(key);}
 for(const key of ['goal','campaign','handoff'])url.searchParams.delete(key);
 for(const [key,value] of Object.entries(params)){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
 return url;
}
