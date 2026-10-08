import {canCompare,metricUnit,metricValue,type BusinessGoal,type Observation,type Campaign,type WorkTask} from './types.ts';
import {progress} from '../marketing-metrics.ts';
export const phaseNames={unrecorded:'状況未登録',planned:'着手前',running:'実行中',observing:'結果を観測中',review:'判断待ち',done:'作業完了'} as const;
export type Phase=keyof typeof phaseNames;
export function goalProgress(goal:BusinessGoal,row:Observation|undefined){if(goal.period)return{current:null,value:null,bar:null,reason:'期間累計の目標です。必要ペースの欄で確認してください。'};const current=row?metricValue(row,goal.metric):null;return{current,...progress({id:goal.id,title:goal.title,unit:metricUnit(goal.metric),baseline:goal.baseline,current,target:goal.target,direction:goal.direction,weight:1,baselinePeriod:goal.baselineSource,currentPeriod:row?.label??'',observationDays:row?.days??0,comparable:canCompare(goal,row),updatedAt:row?.collectedAt??''})};}
export function campaignPhase(c:Campaign):Phase{return c.phase??'unrecorded';}
export function overdue(c:Campaign,today:string){return c.phase!=='done'&&c.end<today;}
export const taskStatusNames={todo:'未着手',doing:'進行中',blocked:'確認待ち',done:'完了'} as const;
export const taskPriorityNames={high:'高',medium:'中',low:'低'} as const;
export function taskOverdue(task:WorkTask,today:string){return task.status!=='done'&&task.due<today;}
const priorityOrder={high:0,medium:1,low:2};
export function sortTasks(tasks:WorkTask[]){return tasks.slice().sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||a.due.localeCompare(b.due)||priorityOrder[a.priority]-priorityOrder[b.priority]||a.title.localeCompare(b.title,'ja'));}
