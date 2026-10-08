import type {BusinessGoal} from './types.ts';
import type {MetricResult} from '../measurement/model.ts';
import {validDate} from '../analytics/model.ts';
const dayMs=86400000;
export function goalRange(goal:BusinessGoal,today:string){
 if(!goal.period||!validDate(today)||!validDate(goal.period.start)||!validDate(goal.deadline))return null;
 const yesterday=new Date(Date.parse(today)-dayMs).toISOString().slice(0,10);
 const end=yesterday<goal.deadline?yesterday:goal.deadline;
 return goal.period.start<=end?{start:goal.period.start,end}:null;
}
export function goalPace(goal:BusinessGoal,metric:MetricResult|undefined,policyVersion:number|null,today:string){
 const unavailable=(reason:string)=>({current:null,remaining:null,days:null,perDay:null,projection:null,achieved:false,reason});
 if(!goal.period)return unavailable('流入集団の比較目標です。期間累計の必要ペースは算出しません。');
 if(goal.direction!=='increase'||!['conversions','revenue'].includes(goal.metric))return unavailable('この指標は期間累計の必要ペースの対象外です。');
 if(!validDate(today))return unavailable('基準日を確認してください。');
 const range=goalRange(goal,today);if(!range)return unavailable('目標期間はまだ開始していないか、完了した日がありません。');
 if(policyVersion!==goal.period.policyVersion)return unavailable('取得元の設定が変わりました。目標設定で取得元を再確認してください。');
 if(!metric||metric.status!=='complete'||metric.error||metric.value===null||metric.expectedDays!==(Date.parse(range.end)-Date.parse(range.start))/dayMs+1)return unavailable('目標期間の取得済みデータが揃っていません。取得元と計測状態を確認してください。');
 const remaining=Math.max(0,goal.target-metric.value),days=Math.max(0,(Date.parse(goal.deadline)-Date.parse(range.end))/dayMs);
 const elapsed=(Date.parse(range.end)-Date.parse(range.start))/dayMs+1,totalDays=(Date.parse(goal.deadline)-Date.parse(goal.period.start))/dayMs+1,projection=elapsed>=7?metric.value/elapsed*totalDays:null;
 return{projection,current:metric.value,remaining,days,perDay:remaining===0?0:days>0?remaining/days:null,achieved:remaining===0,reason:remaining===0?'目標値に到達しています。':days===0?'期限を過ぎています。必要量と次の対応を確認してください。':'達成に必要な平均日次ペースです。達成予測ではありません。'};
}
