import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {exportSkill} from '../scripts/export-agent-skill.mjs';
test('export bundles text references, skips scripts and cannot follow links or symlinks outside the skill',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'astra-skill-'));
 try{const dir=join(temp,'guide');await mkdir(dir);await mkdir(join(dir,'references'));
 await writeFile(join(temp,'private.md'),'PRIVATE OUTSIDE CONTENT');
 await writeFile(join(dir,'SKILL.md'),'---\nname: guide\ndescription: Compare metrics\n---\n[check](references/check.md) [script](run.sh) [outside](../private.md) [alias](alias.md) `Knowledge/required.md`');
 await writeFile(join(dir,'references/check.md'),'Use real data. [nested](nested.md)');await writeFile(join(dir,'references/nested.md'),'Check missing values.');
 await writeFile(join(dir,'run.sh'),'exit 99');await symlink(join(temp,'private.md'),join(dir,'alias.md'));
 const skill=await exportSkill(join(dir,'SKILL.md'));assert.equal(skill.name,'guide');assert.equal(skill.resources.length,2);assert.equal(skill.enabled,false);assert.equal(skill.reviewed,false);
 assert.ok(!JSON.stringify(skill).includes('PRIVATE OUTSIDE CONTENT'));assert.ok(skill.missingReferences.includes('../private.md'));assert.ok(skill.missingReferences.includes('alias.md'));assert.ok(skill.missingReferences.includes('run.sh'));assert.ok(skill.missingReferences.includes('Knowledge/required.md'));
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('explicit Vault export resolves manifest Knowledge and shared rules without sweeping unrelated files',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'astra-vault-'));
 try{
 const dir=join(temp,'.codex/skills/guide');await mkdir(dir,{recursive:true});await mkdir(join(temp,'Knowledge'),{recursive:true});await mkdir(join(temp,'.codex/skills/_shared/runtime'),{recursive:true});
 await writeFile(join(dir,'SKILL.md'),'---\nname: guide\ndescription: Compare metrics\n---\n[manifest](knowledge-manifest.md)');
 await writeFile(join(dir,'knowledge-manifest.md'),'| trigger | path | purpose |\n| 常時 | `.codex/skills/_shared/runtime/policy.md` | Rules |\n| 分析 | `Knowledge/metrics.md` | Define metrics |');
 await writeFile(join(temp,'Knowledge/metrics.md'),'Missing values are not zero.');await writeFile(join(temp,'Knowledge/private.md'),'UNRELATED PRIVATE CONTENT');
 await writeFile(join(temp,'.codex/skills/_shared/runtime/policy.md'),'Read the original evidence.');
 const skill=await exportSkill(join(dir,'SKILL.md'),{vaultRoot:temp});assert.equal(skill.entryPath,'.codex/skills/guide/SKILL.md');assert.equal(skill.resources.length,3);assert.deepEqual(skill.missingReferences,[]);assert.ok(skill.requiredResources.includes('Knowledge/metrics.md'));assert.ok(!JSON.stringify(skill).includes('UNRELATED PRIVATE CONTENT'));
 const {validateSkill,missingRequiredResources}=await import('../lib/autonomy/skills.ts');validateSkill({...skill,enabled:true,reviewed:true});const incomplete={...skill,resources:skill.resources.filter(r=>r.path!=='Knowledge/metrics.md')};assert.deepEqual(missingRequiredResources(incomplete),['Knowledge/metrics.md']);assert.throws(()=>validateSkill({...incomplete,enabled:true,reviewed:true}),/必須ナレッジ/);
 const outside=await mkdtemp(join(tmpdir(),'astra-outside-'));try{await writeFile(join(outside,'secret.md'),'OUTSIDE SECRET');await symlink(join(outside,'secret.md'),join(temp,'Knowledge/escape.md'));await writeFile(join(dir,'knowledge-manifest.md'),'`Knowledge/escape.md`');const escaped=await exportSkill(join(dir,'SKILL.md'),{vaultRoot:temp});assert.ok(!JSON.stringify(escaped).includes('OUTSIDE SECRET'));}finally{await rm(outside,{recursive:true,force:true});}
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('Core and Conditional manifests support more than 30 resources without requiring every domain document',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'astra-selective-'));
 try{
 const dir=join(temp,'.codex/skills/strategy');await mkdir(dir,{recursive:true});await mkdir(join(temp,'Knowledge'),{recursive:true});
 await writeFile(join(dir,'SKILL.md'),'---\nname: strategy\ndescription: Design strategy\n---\n[manifest](knowledge-manifest.md) [workflow](workflow.md)');await writeFile(join(dir,'workflow.md'),'Select relevant Knowledge.');await writeFile(join(dir,'core.md'),'Use confirmed evidence.');
 await writeFile(join(temp,'Knowledge/leaf.md'),'59 desire candidates source.');
 const rows=[];for(let i=0;i<40;i++){const path='Knowledge/topic-'+i+'.md';rows.push('| topic '+i+' | `'+path+'` | Need evidence |');await writeFile(join(temp,path),'Conditional evidence '+i+(i===0?' [source](leaf.md)':''));}
 await writeFile(join(dir,'knowledge-manifest.md'),'## Core\n| path | purpose |\n| `.codex/skills/strategy/core.md` | Method |\n## Conditional\n| trigger | exact path | purpose |\n'+rows.join('\n'));
 const skill=await exportSkill(join(dir,'SKILL.md'),{vaultRoot:temp});const {validateSkill,requiredSkillResources,missingRequiredResources}=await import('../lib/autonomy/skills.ts');assert.equal(skill.readingMode,'selective');assert.equal(skill.resources.length,44);assert.ok(skill.resources.some(r=>r.path==='Knowledge/leaf.md'));assert.ok(!JSON.stringify(skill).includes('UNRELATED PRIVATE CONTENT'));assert.equal(skill.resources.filter(r=>r.trigger).length,40);assert.equal(requiredSkillResources(skill).length,3);assert.ok(!requiredSkillResources(skill).includes('Knowledge/topic-0.md'));validateSkill({...skill,enabled:true,reviewed:true});
 const missing={...skill,requiredResources:['.codex/skills/strategy/workflow.md'],resources:skill.resources.filter(r=>r.path!=='.codex/skills/strategy/core.md')};assert.ok(missingRequiredResources(missing).includes('.codex/skills/strategy/core.md'));assert.throws(()=>validateSkill({...missing,enabled:true,reviewed:true}),/必須ナレッジ/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('ignored local source articles are excluded unless explicitly opted into a local package',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'astra-local-source-'));
 try{
 execFileSync('git',['init','--quiet',temp]);const dir=join(temp,'guide');await mkdir(join(dir,'sources'),{recursive:true});
 await writeFile(join(dir,'SKILL.md'),'---\nname: guide\ndescription: Inspect evidence\n---\n[source](sources/original-article.txt) [rules](core.md)');await writeFile(join(dir,'core.md'),'Use the source index.');await writeFile(join(dir,'sources/.gitignore'),'original-article.txt\n');await writeFile(join(dir,'sources/original-article.txt'),'LOCAL THIRD PARTY SOURCE');
 const safe=await exportSkill(join(dir,'SKILL.md'));assert.ok(!JSON.stringify(safe).includes('LOCAL THIRD PARTY SOURCE'));assert.deepEqual(safe.ignoredSources,['sources/original-article.txt']);
 const local=await exportSkill(join(dir,'SKILL.md'),{includeLocalSources:true});assert.ok(local.resources.some(r=>r.content==='LOCAL THIRD PARTY SOURCE'));assert.deepEqual(local.ignoredSources,[]);
 }finally{await rm(temp,{recursive:true,force:true});}
});
