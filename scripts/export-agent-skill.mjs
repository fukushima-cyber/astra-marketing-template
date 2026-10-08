// Export text only. External references require an explicitly selected Vault root; scripts are never run.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename,sep,relative} from 'node:path';
import {validateSkill,missingSkillReferences,skillReferenceLinks,requiredSkillResources,safeResourcePath} from '../lib/autonomy/skills.ts';
export async function exportSkill(entry,options={}){
 const actual=await realpath(entry),root=dirname(actual),instructions=await readFile(actual,'utf8');
 const metadata=instructions.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]??'';
 const field=name=>metadata.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1]?.replace(/^['"]|['"]$/g,'');
 const name=field('name')||basename(root),description=field('description');
 if(!description)throw new Error('descriptionを1行で指定したSKILL.mdを使ってください。');
 const vault=options.vaultRoot?await realpath(options.vaultRoot):null;
 if(vault&&!actual.startsWith(vault+sep))throw new Error('スキルが指定したVaultの外にあります。');
 const base=vault??root,entryPath=vault?relative(base,actual).split(sep).join('/'):undefined;
 const resources=[],ignoredSources=[],seen=new Set([actual]);
 const visit=async(file,content,externalDepth=0)=>{
  for(let link of skillReferenceLinks(content)){if(/^(https?:|mailto:|#)/i.test(link))continue;
   try{link=decodeURIComponent(link.split('#')[0]);}catch{continue;}
   const target=resolve(vault&&/^(Knowledge|[.]codex)\//.test(link)?vault:dirname(file),link);if(!target.startsWith(base+sep)||!/[.](md|txt|json|csv|ya?ml)$/i.test(target))continue;
   let resolved;try{resolved=await realpath(target);}catch{continue;}
   if(!resolved.startsWith(base+sep)||seen.has(resolved))continue;
   // Only explicitly referenced external files are copied; no traversal of other skills or unrelated Knowledge.
   const outside=!target.startsWith(root+sep),nextDepth=outside?externalDepth+1:0;
   if(vault&&outside&&target.startsWith(resolve(vault,'.codex/skills/_shared/ledgers')+sep))continue;
   if(externalDepth&&(!vault||nextDepth>2||!target.startsWith(resolve(vault,'Knowledge')+sep)&&!target.startsWith(resolve(vault,'.codex/skills/_shared')+sep)))continue;
   let ignored=false;try{execFileSync('git',['-C',root,'check-ignore','--quiet','--',target],{stdio:'ignore'});ignored=true;}catch{}
   if(ignored&&!(options.includeLocalSources===true&&basename(target)==='original-article.txt')){ignoredSources.push(relative(base,target).split(sep).join('/'));continue;}
   const body=await readFile(resolved,'utf8');seen.add(resolved);resources.push({path:relative(base,target).split(sep).join('/'),content:body});
   if(resources.length>120)throw new Error('資料が120件を超えます。用途ごとに分けて登録してください。');if(!outside||vault&&nextDepth<2&&(target.startsWith(resolve(vault,'Knowledge')+sep)||target.startsWith(resolve(vault,'.codex/skills/_shared/runtime')+sep)))await visit(target,body,nextDepth);
  }
 };
 await visit(actual,instructions);
 const skill={id:name,name,description,instructions,resources,...(entryPath?{entryPath}:{}),source:name+'/SKILL.md',enabled:false,reviewed:false,revision:'',updatedAt:''};const manifest=resources.find(r=>r.path.endsWith('/knowledge-manifest.md')||r.path==='knowledge-manifest.md');
 if(manifest&&/## Core/.test(manifest.content)&&/## Conditional/.test(manifest.content)){
  skill.readingMode='selective';const required=new Set();let section='';
  for(const line of manifest.content.split('\n')){if(line.startsWith('## '))section=line.trim();const cols=line.split('|').map(v=>v.trim());const ref=(section==='## Core'?cols[1]:cols[2])?.match(/`([^`]+)`/)?.[1];if(!ref)continue;
   const target=resolve(vault&&/^(Knowledge|[.]codex)\//.test(ref)?vault:dirname(resolve(base,manifest.path)),ref),path=relative(base,target).split(sep).join('/');if(!safeResourcePath(path))continue;
   if(section==='## Core')required.add(path);else if(section==='## Conditional'){const resource=resources.find(r=>r.path===path);if(resource)resource.trigger=cols[1];}
  }
  for(const file of ['workflow.md','knowledge-manifest.md'])required.add(relative(base,resolve(root,file)).split(sep).join('/'));
  skill.requiredResources=[...required];
 }else skill.requiredResources=requiredSkillResources(skill).filter(safeResourcePath);validateSkill(skill);return {...skill,ignoredSources:[...new Set(ignoredSources)],missingReferences:missingSkillReferences(skill)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [entry,output,vaultRoot]=process.argv.slice(2);if(!entry||!output){console.error('Usage: node --experimental-strip-types scripts/export-agent-skill.mjs /path/to/SKILL.md /path/to/output.json');process.exitCode=1;}
 else try{const skill=await exportSkill(entry,{vaultRoot});await writeFile(output,JSON.stringify(skill,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({name:skill.name,resources:skill.resources.length,missingReferenceCount:skill.missingReferences.length,ignoredSources:skill.ignoredSources,enabled:false}));}catch(e){console.error(e.message);process.exitCode=1;}
}
