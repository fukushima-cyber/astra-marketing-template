// Operator-only invitation for this new installation. No public endpoint issues owner credentials.
import {Client} from 'pg';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
const connection=process.env.ASTRA_BACKUP_DB_URL,base=process.env.APP_URL,recover=process.argv.includes('--recover');
if(!connection||!base||!base.startsWith('https://')||new URL(base).origin!==base)throw new Error('Set ASTRA_BACKUP_DB_URL and your HTTPS APP_URL');
const db=new Client({connectionString:connection,ssl:{rejectUnauthorized:true}});
try{
 await db.connect();await db.query('SET search_path=astra,extensions,pg_catalog');
 await db.query('BEGIN');
 const {rows}=await db.query("SELECT id,email FROM users WHERE role='owner' AND company_id='company' FOR UPDATE");
 if(rows.length&&!recover)throw new Error('Owner already registered; use --recover only for that owner');
 if(!rows.length&&recover)throw new Error('No owner to recover');
 if(rows.length>1)throw new Error('Multiple owners require individual recovery');
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),now=new Date().toISOString();
 await db.query("UPDATE invitations SET revoked=1 WHERE role='owner' AND used_by IS NULL");
 await db.query('INSERT INTO invitations(token_hash,company_id,email,role,kind,target_id,expires,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[hash,'company',rows[0]?.email??null,'owner',recover?'reset':'enroll',rows[0]?.id??null,Date.now()+48*3600000,now]);
 await db.query('COMMIT');
 mkdirSync('.data',{recursive:true,mode:0o700});chmodSync('.data',0o700);
 const path=resolve('.data/owner-registration.md');
 writeFileSync(path,`# Owner registration\n\n${base}/join#token=${token}\n\nPrivate, single use, expires in 48 hours. Do not share or commit.\n`,{mode:0o600});chmodSync(path,0o600);
 console.log('Private owner link saved to .data/owner-registration.md');
}catch{try{await db.query('ROLLBACK');}catch{}console.error('Owner invitation failed. Check your installation connection and owner state.');process.exitCode=1;}finally{await db.end();}
