import {validDate} from './analytics/model.ts';
export type DateRange={start:string;end:string};
export const japanToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const move=(date:string,n:number)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
export const rangeNames={month:'当月',week:'今週',day:'今日',yesterday:'昨日',lastWeek:'先週',lastMonth:'先月',days30:'直近30日',year:'今年'};
export function presetRange(key:keyof typeof rangeNames,today=japanToday()):DateRange{const month=today.slice(0,7)+'-01',monday=move(today,-((new Date(today).getUTCDay()+6)%7));switch(key){case'day':return{start:today,end:today};case'yesterday':return{start:move(today,-1),end:move(today,-1)};case'week':return{start:monday,end:today};case'lastWeek':return{start:move(monday,-7),end:move(monday,-1)};case'lastMonth':{const end=move(month,-1);return{start:end.slice(0,7)+'-01',end};}case'days30':return{start:move(today,-29),end:today};case'year':return{start:today.slice(0,4)+'-01-01',end:today};default:return{start:month,end:today};}}
export const validRange=(r:DateRange)=>validDate(r.start)&&validDate(r.end)&&r.start<=r.end;
export function initialRange():DateRange{if(typeof window==='undefined')return presetRange('month');const q=new URLSearchParams(location.search),r={start:q.get('start')??'',end:q.get('end')??''};return validRange(r)?r:presetRange('month');}
export function rememberRange(r:DateRange){const u=new URL(location.href);u.searchParams.set('start',r.start);u.searchParams.set('end',r.end);history.replaceState(null,'',u);}
