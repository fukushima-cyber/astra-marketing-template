import {readFileSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PostgresDatabase} from '../cloud/postgres.ts';
import {migrationTables} from '../cloud/migration-tables.ts';
import {tableFingerprint} from '../cloud/database-migration.ts';
const manifest=JSON.parse(readFileSync(new URL('../docs/data-safety-manifest.json',import.meta.url),'utf8'));
const project=manifest.supabase?.projectId;if(!project)throw new Error('Supabase destination is not approved');
const connection=process.env.ASTRA_BACKUP_DB_URL??JSON.parse(readFileSync(new URL('../.data/supabase-runtime.json',import.meta.url),'utf8')).SUPABASE_DB_URL;
const url=new URL(connection);if(!url.username.endsWith('.'+project)&&url.hostname!=='db.'+project+'.supabase.co')throw new Error('Backup database does not match the approved project');
const db=new PostgresDatabase(connection);
try{
 const names=[...migrationTables,'scheduler_state'];const snapshot=await db.batch(names.map(name=>db.prepare('SELECT * FROM '+name)),true);
 const tables=Object.fromEntries(names.map((name,i)=>[name,snapshot[i].results]));const fingerprints=await Promise.all(names.map(async table=>({table,count:tables[table].length,sha256:await tableFingerprint(tables[table])})));
 const at=new Date().toISOString(),dir=new URL('../.data/backups/',import.meta.url);mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 const file=new URL('supabase-'+at.replace(/[:.]/g,'-')+'.json',dir);writeFileSync(file,JSON.stringify({format:'astra-private-database-backup',project,at,tables,fingerprints}),{mode:0o600});chmodSync(file,0o600);
 console.log(JSON.stringify({file:fileURLToPath(file),tables:names.length,totalRows:fingerprints.reduce((sum,t)=>sum+t.count,0)}));
}finally{await db.close();}
