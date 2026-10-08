import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseMigration,tableFingerprint} from '../cloud/database-migration.ts';
import {usingDatabase} from '../cloud/database-runtime.ts';
import type {Env} from '../cloud/types.ts';
test('migration is unavailable after cutover and rejects missing or invalid tokens',async()=>{
 const request=new Request('https://example.com/api/internal/database-migration',{method:'POST'});
 for(const env of [{},{DB_PROVIDER:'supabase',ASTRA_MIGRATION_ENABLED:'1',ASTRA_MAINTENANCE:'1'}, {DB_PROVIDER:'d1',ASTRA_MIGRATION_ENABLED:'1',ASTRA_MAINTENANCE:'1',ASTRA_MIGRATION_SECRET:'test-secret',SUPABASE:{connectionString:'unused'}}])assert.equal((await databaseMigration(request,env as Env)).status,404);
});
test('unavailable PostgreSQL never falls back to D1',async()=>{
 let accessed=false;const env={DB_PROVIDER:'supabase',DB:{prepare(){accessed=true;throw new Error('Must not access D1');}}} as unknown as Env;
 await assert.rejects(usingDatabase(env,async()=>{accessed=true;return null;}),/not configured/);assert.equal(accessed,false);
 await assert.rejects(usingDatabase({...env,DB_PROVIDER:'unknown'},async()=>null),/not configured/);
});
test('reconciliation preserves nulls, JSON text, casing and milliseconds and ignores row/column order',async()=>{
 const rows=[{id:'a',data:'{"b":2,"a":1}',expires:1791259200000,nullable:null},{id:'b',data:'{}',expires:1,nullable:null}];
 assert.equal(await tableFingerprint(rows),await tableFingerprint([...rows].reverse().map(({id,...rest})=>({...rest,id}))));
 assert.notEqual(await tableFingerprint(rows),await tableFingerprint([{...rows[0],data:'{"a":1,"b":2}'},rows[1]]));
});
