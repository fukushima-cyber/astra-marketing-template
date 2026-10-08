export type Level='campaign'|'adset'|'ad';
export const levels:Record<Level,string>={campaign:'キャンペーン',adset:'広告セット',ad:'広告'};
export const statuses:Record<string,string>={UNAVAILABLE:'今回の一覧に未掲載',ACTIVE:'配信設定中',PAUSED:'停止',DELETED:'削除済み',ARCHIVED:'保管済み',PENDING_REVIEW:'審査中',DISAPPROVED:'不承認',CAMPAIGN_PAUSED:'キャンペーン停止中',ADSET_PAUSED:'広告セット停止中',WITH_ISSUES:'要確認',IN_PROCESS:'処理中'};
export const changeStates:Record<string,string>={draft:'確認待ち',approved:'実行待ち',sending:'実行中・結果確認待ち',succeeded:'反映確認済み',failed:'実行できませんでした',uncertain:'反映結果が不明',cancelled:'取り消し'};
export type Entity={id:string;accountId:string;name:string;level:Level;campaignId:string;adsetId:string;status:string;effectiveStatus:string;dailyBudget:number|null;lifetimeBudget:number|null;updatedTime:string;funnelId?:string;syncMissing?:boolean;creative?:{id:string;name:string;thumbnailUrl?:string;imageUrl?:string;videoId?:string}};
export type Policy={autonomousOperations?:('pause'|'resume'|'budget')[];enabled:boolean;maxDailyBudget:number;maxChangePercent:number;maxOperations:number};
export const defaultPolicy:Policy={enabled:false,maxDailyBudget:0,maxChangePercent:20,maxOperations:3};
export type Change={entity:Entity;field:'status'|'daily_budget';before:string|number;after:string|number;reason:string;caseId:string;policyVersion:number;currency:string};
export type Report={date:string;adId:string;adName:string;campaignId:string;adsetId:string;spend:number|null;impressions:number|null;clicks:number|null;actions:Record<string,number>;actionValues:Record<string,number>};
export function offset(currency:string){return ({JPY:1,USD:100,EUR:100} as Record<string,number>)[currency]??null;}
export function money(n:number|null,currency:string){return n===null?'未取得':new Intl.NumberFormat('ja-JP',{style:'currency',currency}).format(n);}
export function validatePolicy(p:Policy){if(!p||p.autonomousOperations!==undefined&&(!Array.isArray(p.autonomousOperations)||p.autonomousOperations.some(v=>!['pause','resume','budget'].includes(v)))||typeof p.enabled!=='boolean'||!Number.isFinite(p.maxDailyBudget)||p.maxDailyBudget<0||p.maxDailyBudget>1e9||!Number.isFinite(p.maxChangePercent)||p.maxChangePercent<0||p.maxChangePercent>100||!Number.isInteger(p.maxOperations)||p.maxOperations<1||p.maxOperations>30||p.enabled&&p.maxDailyBudget<=0)throw new Error('操作上限と日予算の上限を確認してください。');}
export function checkChange(c:Change,current:Entity,p:Policy,currency:string){
 if(!p.enabled)throw new Error('このアカウントの外部変更は停止中です。');
 if(c.entity.id!==current.id||c.entity.accountId!==current.accountId||c.entity.level!==current.level||c.currency!==currency)throw new Error('対象の広告アカウントを確認してください。');
 if(!['ACTIVE','PAUSED'].includes(current.status))throw new Error('現在の配信状態では変更できません。');
 const before=c.field==='status'?current.status:current.dailyBudget;if(before!==c.before||current.updatedTime!==c.entity.updatedTime)throw new Error('広告側の設定が変わりました。最新状態で変更案を作り直してください。');
 if(c.field==='status'){if(!['ACTIVE','PAUSED'].includes(String(c.after))||c.after===before)throw new Error('変更する配信状態を確認してください。');}
 else{const unit=offset(currency);if(current.level==='ad'||!unit||!current.dailyBudget||current.lifetimeBudget)throw new Error('日予算を直接持つキャンペーン・広告セットだけ変更できます。');const amount=Number(c.after);if(!Number.isSafeInteger(amount)||amount<=0||amount/unit>p.maxDailyBudget)throw new Error('変更後の日予算が設定上限を超えています。');if(Math.abs(amount-current.dailyBudget)/current.dailyBudget*100>p.maxChangePercent+1e-8)throw new Error('1回の予算変更率の上限を超えています。');}
}
export function aggregate(rows:Report[],action:string){const sum=(key:'spend'|'impressions'|'clicks')=>rows.length&&rows.every(r=>r[key]!==null)?rows.reduce((n,r)=>n+r[key]!,0):null;const spend=sum('spend'),clicks=sum('clicks'),impressions=sum('impressions');const results=action&&rows.length?rows.reduce((n,r)=>n+(r.actions[action]??0),0):null;return{spend,clicks,impressions,results,cpc:spend!==null&&clicks?spend/clicks:null,cpa:spend!==null&&results?spend/results:null,ctr:clicks!==null&&impressions?clicks/impressions*100:null};}
