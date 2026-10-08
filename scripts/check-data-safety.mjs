import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const expected=JSON.parse(readFileSync(new URL('../docs/data-safety-manifest.json',import.meta.url),'utf8'));
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
if(config.account_id!==expected.accountId)throw new Error('本番アカウントが変更されています。');
if(expected.provider==='supabase'){
 const binding=config.hyperdrive?.find(b=>b.binding==='SUPABASE');
 if(config.vars?.DB_PROVIDER!=='supabase'||binding?.id!==expected.supabase.hyperdriveId||!binding?.id||config.d1_databases?.length)throw new Error('Supabaseの接続先または保存先が変更されています。移行検証と復旧計画が必要です。');
 const sqlFiles=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 if(JSON.stringify(sqlFiles)!==JSON.stringify(Object.keys(expected.supabase.migrations).sort()))throw new Error('Supabaseの移行ファイル一覧が変更されています。');
 for(const name of sqlFiles){if(createHash('sha256').update(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url))).digest('hex')!==expected.supabase.migrations[name])throw new Error('適用済みSupabaseマイグレーションの変更を検出: '+name);}
}else{
 const binding=config.d1_databases?.find(b=>b.binding==='DB');
 if(binding?.database_id!==expected.databaseId||binding?.database_name!==expected.databaseName||config.vars?.DB_PROVIDER==='supabase')throw new Error('本番D1の接続先が変更されています。データ移行と復旧計画のレビューが必要です。');
}
const actual=readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
if(JSON.stringify(actual)!==JSON.stringify(Object.keys(expected.migrations).sort()))throw new Error('旧D1マイグレーション一覧が変更されています。');
for(const name of actual){const hash=createHash('sha256').update(readFileSync(new URL('../migrations/'+name,import.meta.url))).digest('hex');if(hash!==expected.migrations[name])throw new Error('適用済みマイグレーションの変更を検出: '+name);}
console.log('Database destination and applied migration files verified.');
