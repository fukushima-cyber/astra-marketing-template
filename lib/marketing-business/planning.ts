import {canCompare,metricUnit,metricValue,type BusinessGoal,type Observation,type Campaign} from './types.ts';
import {progress} from '../marketing-metrics.ts';
export const phaseNames={unrecorded:'状況未登録',planned:'着手前',running:'実行中',observing:'結果を観測中',review:'判断待ち',done:'作業完了'} as const;
export type Phase=keyof typeof phaseNames;
export function goalProgress(goal:BusinessGoal,row:Observation|undefined){const current=row?metricValue(row,goal.metric):null;return{current,...progress({id:goal.id,title:goal.title,unit:metricUnit(goal.metric),baseline:goal.baseline,current,target:goal.target,direction:goal.direction,weight:1,baselinePeriod:goal.baselineSource,currentPeriod:row?.label??'',observationDays:row?.days??0,comparable:canCompare(goal,row),updatedAt:row?.collectedAt??''})};}
export function campaignPhase(c:Campaign):Phase{return c.phase??'unrecorded';}
export function overdue(c:Campaign,today:string){return c.phase!=='done'&&c.end<today;}
