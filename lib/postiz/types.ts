export type PostizSyncStatus = "local" | "submitting" | "synced" | "unknown" | "failed";
export type PostizDraft = { platform?:string; assetIds?:string[]; options?:PostOptions; reviewState?:"editing"|"pending"|"changes"|"rejected"; reviewNote?:string; history?:Array<{at:string;message:string}>; id:string; version:number; title:string; content:string; goalId:string; channelId?:string; scheduleAt?:string; createdAt:string; updatedAt:string; remotePostIds:string[]; syncStatus:PostizSyncStatus; syncMode?:"draft"|"schedule" };
export type PostizIntegration = { id:string; name:string; identifier:string; profile:string; disabled:boolean; textOnlySupported:boolean };
export type PostizPost = { id:string; content:string; publishDate:string; state:string; releaseURL:string|null; integration:{id:string; providerIdentifier:string; name:string} };
export type PostizAnalyticsSeries = { label:string; data:Array<{total:string;date:string}>; percentageChange:number|null };
export class PostizError extends Error { readonly code:"validation"|"not_found"|"conflict"|"disabled"|"unknown"|"provider"|"storage"; constructor(message:string,code:PostizError["code"]){super(message);this.code=code;this.name="PostizError";} }

export type PostOptions={format?:'post'|'reel'|'video'|'short';visibility?:'public'|'unlisted'|'private';kids?:'yes'|'no';thumbnailId?:string};
