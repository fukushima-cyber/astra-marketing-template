export const businessKindNames={content:'コンテンツ販売',affiliate:'アフィリエイト'} as const;
export type BusinessKind=keyof typeof businessKindNames;
export type BusinessSummary={id:string;name:string;kind:BusinessKind;archivedAt:string|null;revenueModels?:RevenueModel[];acquisitionChannels?:AcquisitionChannel[];profileVersion?:number};
export const isBusinessKind=(value:unknown):value is BusinessKind=>typeof value==='string'&&Object.hasOwn(businessKindNames,value);

export const revenueModelNames={content:'コンテンツ販売',affiliate:'アフィリエイト',service:'サービス提供',commerce:'物販',subscription:'継続課金',other:'その他'} as const;
export const acquisitionChannelNames={seo:'SEO',ads:'広告',sns:'SNS',email:'メール・LINE',referral:'紹介',direct:'直接流入',other:'その他'} as const;
export type RevenueModel=keyof typeof revenueModelNames;
export type AcquisitionChannel=keyof typeof acquisitionChannelNames;
export function validChoices(value:unknown,names:Record<string,string>):value is string[]{return Array.isArray(value)&&value.length<=Object.keys(names).length&&value.every(v=>typeof v==='string'&&Object.hasOwn(names,v))&&new Set(value).size===value.length;}
export const businessColumns='id,name,kind,archived_at AS archivedAt,revenue_models AS revenueModels,acquisition_channels AS acquisitionChannels,profile_version AS profileVersion';
export function decodeBusiness<T extends {revenueModels?:unknown;acquisitionChannels?:unknown}>(row:T){
 const parse=(v:unknown,names:Record<string,string>)=>{try{const list=typeof v==='string'?JSON.parse(v):v;return validChoices(list,names)?list:[];}catch{return [];}};
 return {...row,revenueModels:parse(row.revenueModels,revenueModelNames) as RevenueModel[],acquisitionChannels:parse(row.acquisitionChannels,acquisitionChannelNames) as AcquisitionChannel[]};
}
export function selectedBusinessId(rows:BusinessSummary[],url:URL){return rows.find(b=>b.id===url.searchParams.get('businessId')&&!b.archivedAt)?.id??'';}
export function businessSwitchUrl(current:URL,id:string){const url=new URL('/marketing',current.origin);if(id)url.searchParams.set('businessId',id);url.searchParams.set('panel','dashboard');for(const k of ['start','end']){const v=current.searchParams.get(k);if(v)url.searchParams.set(k,v);}return url;}
