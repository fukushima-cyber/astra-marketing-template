export type MarketingProject={id:string;name:string;product:string;objective:string};
export type FunnelStage={position?:{x:number;y:number};id:string;name:string;action:string;metric:string;url:string};
export type FunnelConnection={id:string;from:string;to:string};
export type ProjectFunnel={connections?:FunnelConnection[];id:string;projectId:string;name:string;source:'sns'|'ads'|'other';medium:string;status:'draft'|'active'|'paused';goalIds:string[];notes:string;stages:FunnelStage[]};
export const sourceNames={sns:'SNS流入',ads:'広告流入',other:'その他の流入'};
export function validFunnelRegistry(projects:MarketingProject[],funnels:ProjectFunnel[],goalIds:string[]):boolean{
 const str=(v:unknown,max=2000):v is string=>typeof v==='string'&&v.length<=max;
 const named=(v:unknown):v is string=>str(v,100)&&!!v.trim();
 const list=(v:unknown,max:number):v is {id:string}[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>x&&named(x.id))&&new Set(v.map(x=>x.id)).size===v.length;
 if(!list(projects,100)||!list(funnels,500))return false;
 if(projects.some(p=>!named(p.name)||!str(p.product)||!str(p.objective)))return false;
 return funnels.every(f=>projects.some(p=>p.id===f.projectId)&&named(f.name)&&Object.hasOwn(sourceNames,f.source)&&str(f.medium,100)&&['draft','active','paused'].includes(f.status)&&str(f.notes)&&Array.isArray(f.goalIds)&&f.goalIds.every(id=>goalIds.includes(id))&&list(f.stages,30)&&f.stages.length>=2&&validConnections(f)&&f.stages.every(s=>{if(s.position&&(!Number.isFinite(s.position.x)||!Number.isFinite(s.position.y)||s.position.x<0||s.position.y<0||s.position.x>3000||s.position.y>6000))return false;if(!named(s.name)||!str(s.action)||!named(s.metric)||!str(s.url))return false;if(!s.url)return true;try{const u=new URL(s.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}));
}

export function connectionsFor(f:ProjectFunnel):FunnelConnection[]{return f.connections??f.stages.slice(1).map((s,i)=>({id:`legacy-${s.id}`,from:f.stages[i].id,to:s.id}));}
export function validConnections(f:ProjectFunnel):boolean{
 if(f.connections===undefined)return true;
 if(!Array.isArray(f.connections)||f.connections.length>100)return false;
 const pairs=new Set<string>(),ids=new Set<string>();
 return f.connections.every(e=>{if(!e||typeof e.id!=='string'||!e.id||e.id.length>100||ids.has(e.id)||e.from===e.to||!f.stages.some(s=>s.id===e.from)||!f.stages.some(s=>s.id===e.to))return false;const pair=JSON.stringify([e.from,e.to]);if(pairs.has(pair))return false;pairs.add(pair);ids.add(e.id);return true;});
}

export const consultationStages=['LINE登録','面談申込','予約','着座','2回目面談','3回目面談','成約'];
export function stagesFromNames(names:string[],id:()=>string):FunnelStage[]{
 if(names.length<2||names.length>30||names.some(n=>!n.trim()||n.trim().length>100))throw new Error('段階は2〜30個、名前は100文字以内で入力してください。');
 return names.map((name,i)=>({id:id(),name:name.trim(),metric:name.trim()+'の件数',action:names[i+1]?names[i+1].trim()+'へ進む':'',url:'',position:{x:80,y:50+i*180}}));
}
// Return the actual connected order only for a single, complete path.
export function linearStageOrder(f:ProjectFunnel):FunnelStage[]|null{
 const edges=connectionsFor(f);if(edges.length!==f.stages.length-1)return null;
 const starts=f.stages.filter(s=>!edges.some(e=>e.to===s.id));if(starts.length!==1)return null;
 const result:FunnelStage[]=[],seen=new Set<string>();let current:FunnelStage|undefined=starts[0];
 while(current){if(seen.has(current.id))return null;seen.add(current.id);result.push(current);const next=edges.filter(e=>e.from===current!.id);if(next.length>1)return null;current=next.length?f.stages.find(s=>s.id===next[0].to):undefined;}
 return result.length===f.stages.length?result:null;
}
