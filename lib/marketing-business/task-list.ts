import {taskOverdue} from './planning.ts';
import type {WorkTask} from './types.ts';
export type TaskFilters={status:string;campaign:string;assignee:string;query:string};
export function taskMatches(task:WorkTask,filters:TaskFilters,today:string,members:{id:string;name:string}[]){
 const {status,campaign,assignee,query}=filters,member=members.find(m=>m.id===assignee);
 return (status==='all'||status==='active'&&task.status!=='done'||status==='overdue'&&taskOverdue(task,today)||task.status===status)&&(campaign==='all'||campaign==='none'&&!task.campaignId||task.campaignId===campaign)&&(assignee==='all'||assignee==='none'&&!task.assignee||task.assigneeId===assignee||!task.assigneeId&&task.assignee===member?.name)&&(!query.trim()||(task.title+' '+task.notes).toLocaleLowerCase('ja').includes(query.trim().toLocaleLowerCase('ja')));
}
export function visibleTaskFilters(task:WorkTask,filters:TaskFilters,today:string,members:{id:string;name:string}[]){
 const next={...filters};for(const key of ['status','campaign','assignee','query'] as const){const isolated={status:'all',campaign:'all',assignee:'all',query:'',[key]:next[key]};if(!taskMatches(task,isolated,today,members))next[key]=key==='query'?'':'all';}return next;
}
