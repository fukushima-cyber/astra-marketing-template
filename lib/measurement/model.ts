import {measures,validDate,type Fact,type Measure} from '../analytics/model.ts';
import {daysIn} from '../ads/reporting.ts';
export type Binding={kind:'import';source:string;funnelId:string}|{kind:'ads';connectionIds:string[]}|{kind:'utage';connectionId:string;funnelId:string;pageId:string};
export type MetricPolicy={version:number;metrics:Record<Measure,Binding>};
export const initialMetricPolicy:MetricPolicy={version:0,metrics:Object.fromEntries(Object.keys(measures).map(k=>[k,{kind:'import',source:'',funnelId:''}])) as Record<Measure,Binding>};
export type MetricStatus='complete'|'partial'|'missing'|'mixed'|'restricted'|'stale';
export const metricStatusNames:Record<MetricStatus,string>={complete:'取得済み',partial:'一部未取得',missing:'未取得',mixed:'定義が混在',restricted:'閲覧範囲外',stale:'更新が古い'};
export type MetricResult={value:number|null;recordedValue:number|null;status:MetricStatus;source:string;definition:string;collectedAt:string|null;coveredDays:number;expectedDays:number;missingValues:number;error?:string;points?:MetricPoint[]};
export type MetricPoint={date:string;value:number|null;collectedAt:string;definition:string};
export function validateMetricPolicy(v:unknown):MetricPolicy{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('取得元の設定を確認してください。');const p=v as MetricPolicy;
 if(!Number.isSafeInteger(p.version)||p.version<0||!p.metrics||Object.keys(p.metrics).length!==Object.keys(measures).length)throw new Error('設定の版と指標を確認してください。');
 const str=(x:unknown,max=200)=>typeof x==='string'&&x.length<=max;
 for(const key of Object.keys(measures) as Measure[]){const b=p.metrics[key];if(!b||typeof b!=='object')throw new Error('指標の取得元を確認してください。');
 if(b.kind==='import'){if(!str(b.source,100)||!str(b.funnelId,100)||Object.keys(b).some(k=>!['kind','source','funnelId'].includes(k)))throw new Error('取込実績の条件を確認してください。');}
 else if(b.kind==='ads'){if(key!=='cost'||!Array.isArray(b.connectionIds)||!b.connectionIds.length||b.connectionIds.length>20||b.connectionIds.some(id=>!str(id,100)||!id)||new Set(b.connectionIds).size!==b.connectionIds.length||Object.keys(b).some(k=>!['kind','connectionIds'].includes(k)))throw new Error('広告APIは広告費だけに指定できます。');}
 else if(b.kind==='utage'){if(!['revenue','registrations','sales'].includes(key)||!str(b.connectionId,100)||!b.connectionId||!str(b.funnelId,100)||!b.funnelId||!str(b.pageId,300)||!b.pageId||Object.keys(b).some(k=>!['kind','connectionId','funnelId','pageId'].includes(k)))throw new Error('UTAGEは登録・購入・売上のページを指定してください。');}
 else throw new Error('対応していない取得元です。');}
 return structuredClone(p);
}
export function summarizeMetric(points:MetricPoint[],start:string,end:string,source:string,now=new Date(),includeDetail=false):MetricResult{
 const days=daysIn(start,end),selected=points.filter(p=>validDate(p.date)&&p.date>=start&&p.date<=end);
 const covered=new Set(selected.map(p=>p.date)),definitions=new Set(selected.map(p=>p.definition));
 const duplicate=selected.length!==new Set(selected.map(p=>p.date+'\0'+p.definition)).size;
 const known=selected.filter(p=>typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=0),missingValues=selected.length-known.length;
 const collected=selected.map(p=>p.collectedAt).filter(d=>Number.isFinite(Date.parse(d))).sort(),collectedAt=collected[0]??null;
 const recordedValue=known.length?known.reduce((n,p)=>n+p.value!,0):null;
 let status:MetricStatus=!selected.length?'missing':definitions.size>1||duplicate?'mixed':covered.size!==days.length||missingValues?'partial':'complete';
 if(status==='complete'&&(!collectedAt||now.getTime()-Date.parse(collectedAt)>48*3600000))status='stale';
 return{...(includeDetail?{points:selected}:{}),value:['complete','stale'].includes(status)?recordedValue:null,recordedValue,status,source,definition:[...definitions].join(' / '),collectedAt,coveredDays:covered.size,expectedDays:days.length,missingValues};
}
export function importedMetric(rows:Fact[],key:Measure,b:Extract<Binding,{kind:'import'}>,start:string,end:string,now?:Date,includeDetail=false){
 const rs=rows.filter(r=>(!b.source||r.source===b.source)&&(!b.funnelId||r.funnelId===b.funnelId));
 // Several records with one definition on a day are additive; differing sources/definitions are never blended.
 const groups=new Map<string,Fact[]>();for(const r of rs){const k=JSON.stringify([r.date,r.source,r.definition]);groups.set(k,[...(groups.get(k)??[]),r]);}
 return summarizeMetric([...groups.values()].map(xs=>({date:xs[0].date,value:xs.every(r=>r.values[key]!==null)?xs.reduce((n,r)=>n+r.values[key]!,0):null,collectedAt:xs.map(r=>r.collectedAt).sort()[0],definition:xs[0].source+' / '+xs[0].definition})),start,end,'取込実績'+(b.source?' / '+b.source:''),now,includeDetail);
}
