import type {Env} from './types.ts';
import {PostgresDatabase} from './postgres.ts';
import {migrationTables} from './migration-tables.ts';
import {digest} from './storage.ts';
type Row=Record<string,string|number|null>;
export async function tableFingerprint(rows:Row[]){return digest(JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]))).map(row=>JSON.stringify(row)).sort()));}
export async function databaseMigration(request:Request,env:Env){
 const send=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(env.ASTRA_MIGRATION_ENABLED!=='1'||env.ASTRA_MAINTENANCE!=='1'||env.DB_PROVIDER==='supabase'||!env.ASTRA_MIGRATION_SECRET||!env.SUPABASE)return send({error:'Not available'},404);
 // Compare hashes to avoid leaking token differences through a prefix comparison.
 if(request.method!=='POST'||await digest(request.headers.get('X-Astra-Migration')??'')!==await digest(env.ASTRA_MIGRATION_SECRET))return send({error:'Not available'},404);
 const target=new PostgresDatabase(env.SUPABASE!.connectionString,false,true);
 try{
  const source=await env.DB.batch(migrationTables.map(table=>env.DB.prepare('SELECT * FROM '+table)));
  const tables=source.map((result,i)=>({name:migrationTables[i],rows:(result as {results:Row[]}).results}));
  if(tables.some(table=>!Array.isArray(table.rows)))throw new Error('Invalid snapshot');
  const existing=await Promise.all(tables.map(table=>target.prepare('SELECT * FROM '+table.name).all<Row>()));
  const occupied=existing.some(result=>result.results.length>0);
  if(!occupied){const statements=tables.flatMap(table=>table.rows.map(row=>{const columns=Object.keys(row);if(columns.some(key=>!/^[a-z_]+$/.test(key)))throw new Error('Invalid snapshot column');return target.prepare('INSERT INTO '+table.name+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...columns.map(key=>row[key]));}));await target.batch(statements);}
  const verified=[];
  for(const table of tables){const copied=(await target.prepare('SELECT * FROM '+table.name).all<Row>()).results;const fingerprint=await tableFingerprint(table.rows);if(copied.length!==table.rows.length||await tableFingerprint(copied)!==fingerprint)throw new Error('Snapshot reconciliation failed');verified.push({table:table.name,count:copied.length,sha256:fingerprint});}
  let schedulerStates=0;const businesses=tables.find(table=>table.name==='businesses')!.rows;for(const business of businesses){const object=env.ASTRA_LOOP?.getByName(String(business.id));if(object?.migrateState&&await object.migrateState())schedulerStates++;}
  return send({verified:true,alreadyCopied:occupied,tables:verified,schedulerStates});
 }catch{return send({error:'Migration failed; source remains unchanged'},500);}finally{await target.close();}
}
