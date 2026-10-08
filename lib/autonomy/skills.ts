export type SkillResource={path:string;content:string;trigger?:string};
export type AgentSkill={id:string;name:string;description:string;instructions:string;resources:SkillResource[];readingMode?:'selective';entryPath?:string;requiredResources?:string[];source:string;enabled:boolean;reviewed:boolean;revision:string;updatedAt:string};
export type SkillState={version:number;skills:AgentSkill[]};
export const emptySkills:SkillState={version:0,skills:[]};
export const safeResourcePath=(path:unknown):path is string=>typeof path==='string'&&path.length<=200&&!/[\\\x00-\x1f<>:"|?*]/.test(path)&&!path.startsWith('/')&&!path.split('/').some(p=>!p||p==='.'||p==='..');
const text=(v:unknown,n:number)=>typeof v==='string'&&v.length<=n&&!v.includes('\0');
export function validateSkill(s:unknown):asserts s is AgentSkill{
 const v=s as AgentSkill;
 if(!v||!text(v.id,80)||!/^[-a-zA-Z0-9]+$/.test(v.id)||!text(v.name,100)||!v.name.trim()||!text(v.description,2000)||!v.description.trim()||!text(v.instructions,40000)||!v.instructions.trim()||!text(v.source,1000)||typeof v.enabled!=='boolean'||typeof v.reviewed!=='boolean'||v.enabled&&!v.reviewed||!Array.isArray(v.resources)||v.resources.length>120||v.resources.some(r=>!r||!safeResourcePath(r.path)||r.path==='SKILL.md'||!text(r.content,40000)||r.trigger!==undefined&&!text(r.trigger,1000))||new Set(v.resources.map(r=>r.path)).size!==v.resources.length||new TextEncoder().encode(JSON.stringify(v)).byteLength>900000)throw new Error('スキル名、用途、本文、参照資料と確認状態を見直してください。');
 if(v.entryPath!==undefined&&!safeResourcePath(v.entryPath)||v.requiredResources!==undefined&&(!Array.isArray(v.requiredResources)||v.requiredResources.length>120||v.requiredResources.some(p=>!safeResourcePath(p))))throw new Error('資料の参照元と必須資料のパスを確認してください。');
 if(v.readingMode!==undefined&&v.readingMode!=='selective')throw new Error('資料の選択方法を確認してください。');
 if(v.readingMode==='selective'&&(!Array.isArray(v.requiredResources)||!v.requiredResources.length))throw new Error('基本資料のパスを指定してください。');
 if(v.enabled&&missingRequiredResources(v).length)throw new Error('必須ナレッジが不足しています。本文を登録するまで有効化できません。');
}
export function skillCatalog(s:SkillState){return {version:s.version,skills:s.skills.map(({instructions,resources,...v})=>({...v,resourcePaths:resources.map(r=>r.path),resourceCatalog:resources.map(r=>({path:r.path,trigger:r.trigger??''})),requiredResources:requiredSkillResources({instructions,resources,...v}),missingRequiredResources:missingRequiredResources({instructions,resources,...v}),missingReferences:missingSkillReferences({instructions,resources,...v})}))};}

export function skillReferenceLinks(content:string){
 const links=Array.from(content.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))[^)]*\)/g),m=>m[1]??m[2]);
 const code=Array.from(content.matchAll(/`([^`\r\n]+)`/g),m=>m[1]).filter(v=>/^[^<>:]*[.](md|txt|json|csv|ya?ml|sqlite|py|js|sh)$/i.test(v));
 return [...new Set([...links,...code])];
}
export type SkillPackage=Pick<AgentSkill,'instructions'|'resources'|'entryPath'|'requiredResources'|'readingMode'>;
export function resolveSkillReference(file:string,link:string){
 if(/^(https?:|mailto:|#)/i.test(link))return null;
 try{link=decodeURIComponent(link.split('#')[0]);}catch{return null;}
 if(link.startsWith('/'))return null;
 const parts=/^(Knowledge|[.]codex)\//.test(link)?[]:file.split('/').slice(0,-1);
 for(const part of link.split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part&&part!=='.')parts.push(part);}
 const path=parts.join('/');return safeResourcePath(path)?path:null;
}
export function requiredSkillResources(s:SkillPackage){
 const required=new Set(s.requiredResources??[]);
 if(s.readingMode==='selective'){
  for(const r of s.resources.filter(r=>r.path.endsWith('knowledge-manifest.md'))){let core=false;for(const line of r.content.split('\n')){if(line.startsWith('## '))core=line.trim()==='## Core';if(!core)continue;const ref=line.split('|')[1]?.match(/`([^`]+)`/)?.[1];if(ref)required.add(resolveSkillReference(r.path,ref)??ref);}}
  return [...required];
 }
 for(const ref of skillReferenceLinks(s.instructions)){if(/^(https?:|mailto:|#)/i.test(ref))continue;if(/[.](md|txt|json|csv|ya?ml)(#.*)?$/i.test(ref)){const path=resolveSkillReference(s.entryPath??'SKILL.md',ref);required.add(path??ref);}}
 // The manifest describes the skill's dependencies. Common rules and domain Knowledge are required.
 for(const r of s.resources.filter(r=>r.path.endsWith('knowledge-manifest.md'))){
  for(const line of r.content.split('\n')){const cols=line.split('|').map(v=>v.trim());if(cols.length<4)continue;const ref=cols[2]?.match(/`([^`]+)`/)?.[1];if(ref&&(cols[1]==='常時'||ref.startsWith('Knowledge/'))){const path=resolveSkillReference(r.path,ref);if(path)required.add(path);}}
 }
 return [...required];
}
export function missingRequiredResources(s:SkillPackage){const paths=new Set([s.entryPath??'SKILL.md',...s.resources.filter(r=>r.content.trim()).map(r=>r.path)]);return requiredSkillResources(s).filter(p=>!paths.has(p));}
export function missingSkillReferences(s:SkillPackage){
 const paths=new Set([s.entryPath??'SKILL.md',...s.resources.map(r=>r.path)]),missing=new Set<string>();
 for(const file of [{path:s.entryPath??'SKILL.md',content:s.instructions},...s.resources]){
  for(const link of skillReferenceLinks(file.content)){if(/^(https?:|mailto:|#)/i.test(link))continue;const path=resolveSkillReference(file.path,link);if(!path||!paths.has(path))missing.add(link);}
 }
 return [...missing];
}
