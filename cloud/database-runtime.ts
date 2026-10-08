import type {Env} from './types.ts';
import {PostgresDatabase} from './postgres.ts';
export async function usingDatabase<T>(env:Env,operation:(runtime:Env)=>Promise<T>):Promise<T>{
 if(!env.DB_PROVIDER||env.DB_PROVIDER==='d1')return operation(env);
 if(env.DB_PROVIDER!=='supabase'||!env.SUPABASE)throw new Error('Database is not configured');
 const db=new PostgresDatabase(env.SUPABASE!.connectionString,false,true);
 try{return await operation({...env,DB:db});}finally{await db.close();}
}
