import {Client,types} from 'pg';
import {supabaseCa} from './supabase-ca.ts';
import type {Database,Statement} from './types.ts';
import {postgresSql} from './postgres-sql.ts';
const number=(value:string)=>{
 const n=Number(value);
 if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new Error('Database number exceeds supported range');
 return n;
};
types.setTypeParser(20,number);
types.setTypeParser(1700,number);
type BoundStatement=Statement&{source:string;values:()=>unknown[];owner:PostgresDatabase};
export class PostgresDatabase implements Database {
 private client:Client;
 private connected:Promise<unknown>|null=null;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(connectionString:string,local=false,hyperdrive=false){
  const url=new URL(connectionString);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!local&&!hyperdrive&&!/(^|\.)supabase\.(co|com)$/.test(url.hostname))throw new Error('Supabase connection is not configured correctly');
  // Hyperdrive's binding supplies the local tunnel; its origin verifies TLS and hostname.
  this.client=new Client({connectionString,ssl:local||hyperdrive?false:{rejectUnauthorized:true,ca:supabaseCa},connectionTimeoutMillis:10000,query_timeout:15000,application_name:'astra-marketing'});
 }
 private serialize<T>(operation:()=>Promise<T>):Promise<T>{
  const result=this.tail.then(operation);
  this.tail=result.catch(()=>{});
  return result;
 }
 private async execute(source:string,args:unknown[]){
  this.connected??=this.client.connect();
  await this.connected;
  const query=postgresSql(source);
  if(query.parameters!==args.length)throw new Error('SQL parameter count mismatch');
  return this.client.query(query.sql,args);
 }
 prepare(source:string,args:unknown[]=[]):Statement{
  const db=this;
  return {
   bind(...values:unknown[]){return db.prepare(source,values);},
   async first<T>(){const values=[...args],r=await db.serialize(()=>db.execute(source,values));return (r.rows[0]??null) as T|null;},
   async all<T>(){const values=[...args],r=await db.serialize(()=>db.execute(source,values));return {results:r.rows as T[]};},
   async run(){const values=[...args],r=await db.serialize(()=>db.execute(source,values));return {meta:{changes:r.rowCount??0}};},
   ...{source,values:()=>[...args],owner:db}
  };
 }
 batch(statements:Statement[],snapshot=false){
  const bound=statements.map(statement=>{
   const s=statement as BoundStatement;
   if(s.owner!==this)throw new Error('Foreign database statement');
   return {source:s.source,args:s.values()};
  });
  return this.serialize(async()=>{
   this.connected??=this.client.connect();
   await this.connected;
   const rows:unknown[]=[];
   await this.client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
   try{
    for(const s of bound){const result=await this.execute(s.source,s.args);rows.push({results:result.rows,meta:{changes:result.rowCount??0}});}
    await this.client.query('COMMIT');
    return rows;
   }catch(error){await this.client.query('ROLLBACK');throw error;}
  });
 }
 async close(){
  await this.tail;
  if(this.connected)try{await this.connected;await this.client.end();}catch{/* Do not expose connection strings when a connection failed. */}
 }
}
