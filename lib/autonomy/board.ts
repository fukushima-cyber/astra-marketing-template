import type {Improvement, Knowledge} from '../improvements/model.ts';
export const campaignStates={draft:'提案・下書き',queued:'実行待ち',running:'操作中',observing:'観測中',decision:'判断待ち',attention:'要確認',completed:'完了・見送り'} as const;
export type CampaignState=keyof typeof campaignStates;
export const actionNames:Record<string,string>={read_skills:'スキルの用途を確認',read_skill:'スキル本文の参照',read_skill_resource:'スキルの資料を参照',record_skill_usage:'スキルの適用報告',model:'次の判断',read_business:'目標と事業の確認',read_metrics:'実績の調査',read_knowledge:'ナレッジの参照',read_improvements:'過去の施策の確認',read_ads:'広告の実績確認',refresh_ads:'広告実績の取得',read_connections:'接続先の確認',collect_connection:'最新値の取得',read_connected:'接続先の実績確認',create_improvement:'改善案の作成',prepare_improvement:'下書き・施策の作成',save_experiment:'比較実験の登録',evaluate_experiment:'比較実験の評価',observe_ad_change:'広告施策の観測開始',close_improvement:'施策の振り返り',propose_ad_change:'広告変更案の作成',execute_ad_change:'広告変更の実行',check_ad_change:'広告の反映確認',schedule_review:'次の観測を予約',request_input:'利用者への確認'};
export type BoardAction={id:string;jobId:string;name:string;status:string;at:string;issue:string;message:string;jobStatus:string;question:string;nextAt:number|null;skill?:{name:string;revision:string;application:string;resourcesRead:string[]}};
export type AgentCampaign={id:string;title:string;goal:string;funnel:string;state:CampaignState;phase:Improvement['phase'];operation:Improvement['operation'];owner:string;due:string;updatedAt:string;hypothesis:string;change:string;stopRule:string;result:Improvement['result'];resultNote:string;resultSource:string;evidence:Improvement['evidence'];preparedRef?:string;actions:BoardAction[];actionCount:number};
export type AgentBoard={campaigns:AgentCampaign[];knowledge:Knowledge[];generatedAt:string;executor:'astra';dotConnected:false};
export function campaignState(phase:Improvement['phase'],latest:BoardAction|undefined,enabled:boolean):CampaignState{
 if(phase==='closed'||phase==='rejected')return 'completed';
 if(latest?.issue||latest?.status==='failed'||latest?.status==='started'&&(latest.jobStatus!=='running'||!enabled))return 'attention';
 if(latest?.jobStatus==='needs_input')return 'decision';
 if(latest?.status==='started'&&latest.jobStatus==='running'&&enabled)return 'running';
 return ({draft:'draft',approved:'queued',prepared:'draft',observing:'observing',review:'decision'} as const)[phase];
}
