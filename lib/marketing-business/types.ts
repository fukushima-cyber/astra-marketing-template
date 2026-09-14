import type { MarketingProject, ProjectFunnel } from './funnels.ts';
export type Observation={id:string;label:string;start:string;end:string;days:number;source:string;collectedAt:string;visitors:number|null;registrations:number|null;bookings:number|null;meetings:number|null;conversions:number|null;adSpend:number|null;revenue:number|null;grossProfit:number|null};
export type Metric='conversions'|'bookingRate'|'cpa'|'revenue'|'grossProfit';
export type BusinessGoal={baselineDays:number;comparisonConfirmed:boolean;comparisonObservation?:string;id:string;title:string;metric:Metric;baseline:number;target:number;direction:'increase'|'decrease';deadline:string;owner:string;baselineSource:string};
export type Campaign={phase?:'planned'|'running'|'observing'|'review'|'done';assignee?:string;funnelId?:string;id:string;title:string;goalId:string;hypothesis:string;change:string;comparison:string;stopRule:string;start:string;end:string;result:'pending'|'continue'|'change'|'stop';reason:string;source:string;postIds:string[]};
export type BusinessData={projects?:MarketingProject[];funnels?:ProjectFunnel[];version:number;name:string;objective:string;goals:BusinessGoal[];observations:Observation[];campaigns:Campaign[];updatedAt:string};
export const emptyBusiness:BusinessData={version:0,name:'',objective:'',goals:[],observations:[],campaigns:[],updatedAt:''};
export const metricNames:Record<Metric,string>={conversions:'成約数',bookingRate:'予約率',cpa:'顧客獲得単価',revenue:'売上',grossProfit:'粗利'};
export function metricValue(row:Observation,metric:Metric):number|null{if(metric==='bookingRate')return row.registrations&&row.bookings!==null?row.bookings/row.registrations*100:null;if(metric==='cpa')return row.conversions&&row.adSpend!==null?row.adSpend/row.conversions:null;return row[metric];}
export const metricUnit=(metric:Metric)=>metric==='conversions'?'件':metric==='bookingRate'?'%':'円';

export const observationSignature=(row:Observation)=>JSON.stringify(row);
export function canCompare(goal:BusinessGoal,row:Observation|undefined):boolean{return !!row&&goal.comparisonConfirmed&&goal.comparisonObservation===observationSignature(row)&&row.days===goal.baselineDays&&Date.parse(row.collectedAt)>=Date.parse(row.end)+row.days*86400000;}
