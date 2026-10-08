export const adProviders = ['google','line','meta','x','tiktok','chatgpt'] as const;
export type AdProvider = typeof adProviders[number];
export const adProviderNames:Record<AdProvider,string>={google:'Google広告',line:'LINE広告',meta:'Meta広告（Facebook / Instagram）',x:'X広告',tiktok:'TikTok広告',chatgpt:'ChatGPT広告'};
export const credentialFields:Record<AdProvider,{key:string;label:string;optional?:boolean}[]>={
 google:[{key:'developerToken',label:'Google Ads 開発者トークン'},{key:'clientId',label:'OAuthクライアントID'},{key:'clientSecret',label:'OAuthクライアントシークレット'},{key:'refreshToken',label:'リフレッシュトークン'},{key:'loginCustomerId',label:'管理アカウントID（ハイフンなし）',optional:true}],
 line:[{key:'accessKey',label:'LINE広告 Access key'},{key:'secretKey',label:'LINE広告 Secret key'},{key:'currency',label:'広告アカウントの通貨（例：JPY）'},{key:'timezone',label:'広告アカウントの時間帯（例：Asia/Tokyo）'}],
 meta:[{key:'token',label:'ads_read権限のアクセストークン'}],
 x:[{key:'consumerKey',label:'API Key'},{key:'consumerSecret',label:'API Key Secret'},{key:'accessToken',label:'Access Token'},{key:'accessTokenSecret',label:'Access Token Secret'}],
 tiktok:[{key:'token',label:'Business APIアクセストークン'}],chatgpt:[{key:'token',label:'Advertiser API key（広告専用）'}],
};
export const adProviderHelp:Record<AdProvider,string>={
 google:'Google Ads APIの利用権限があるCloudプロジェクトと、広告アカウントにアクセスできるOAuth認証を使用します。会社へのGoogleログインとは別の認証です。',
 line:'LINE広告APIの利用承認があるグループのキーを使用します。公式LINEのMessaging APIやUTAGEのキーは使えません。通貨と時間帯は広告管理画面の設定を入力してください。',
 meta:'Facebook広告とInstagram広告を同じMeta広告アカウントから取得します。既存の広告変更機能とは認証を別管理しますが、ダッシュボードにはこの実績だけを集計します。',
 x:'Ads APIを利用できるアプリのOAuth 1.0a認証を使用します。通常のSNS取得トークンとは別です。X上の通常広告、Spotlight、Trendを取得します。過去の大量データ取込は未対応です。',
 tiktok:'TikTok for Businessのアプリで認可された広告アカウントとトークンを使用します。個人アカウント用トークンは使えません。',
 chatgpt:'広告管理画面で発行したAdvertiser API keyを使用します。モデル呼び出し用のOpenAI APIキーとは別です。アカウントIDはadacct_から始まるIDです。',
};
export const conversionDefinitions:Record<AdProvider,string>={google:'Googleのコンバージョン列（アカウント設定に従う）',line:'LINEのcvWithCvApi（CV APIを含む）',meta:'MetaのWeb購入（offsite_conversion.fb_pixel_purchase）',x:'この接続では成果数は未取得',tiktok:'TikTokのconversion（最適化目標に従う）',chatgpt:'この接続では成果数は未取得'};
export type AdMetrics={spend:number|null;impressions:number|null;clicks:number|null;conversions:number|null;conversionValue:number|null};
export type AdReport=AdMetrics&{day:string;campaignId:string;campaignName:string;placement:string};
export type AdConnection={id:string;provider:AdProvider;external_id:string;name:string;currency:string;timezone:string;last_sync:string|null;last_error:string|null;busy_until:string|null;coverage:{day:string;collected_at:string}[]};
export type ReportingData={connections:AdConnection[];reports:(AdReport&{connectionId:string})[];ready:boolean};
export function metricNumber(v:unknown):number|null {if(v===null||v===undefined||v==='')return null;const n=typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;if(!Number.isFinite(n))throw new Error('媒体の数値形式を確認できません。');return n;}
export function sumAdMetrics(rows:AdMetrics[]):AdMetrics {return Object.fromEntries(['spend','impressions','clicks','conversions','conversionValue'].map(k=>[k,rows.length&&rows.every(r=>r[k as keyof AdMetrics]!==null)?rows.reduce((n,r)=>n+r[k as keyof AdMetrics]!,0):null])) as AdMetrics;}
export function adRatio(a:number|null,b:number|null,multiplier=1){return a!==null&&b!==null&&b>0?a/b*multiplier:null;}
export function dayAfter(day:string,n=1){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function daysIn(start:string,end:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)-Date.parse(start)>366*86400000)return [];const days:string[]=[];for(let d=start;d<=end;d=dayAfter(d))days.push(d);return days;}
