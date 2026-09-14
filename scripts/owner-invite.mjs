// Run by the deployment operator. No public endpoint can issue an owner invitation.
import {d1Json} from './d1-json.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
const local=process.argv.includes('--local'),recover=process.argv.includes('--recover');
const database=process.env.D1_DATABASE;
if(!database||!/^[-a-zA-Z0-9_]+$/.test(database))throw new Error('D1_DATABASE に自分のデータベース名を設定してください。');
const base=local?'http://127.0.0.1:8787':process.env.APP_URL;
if(!base||(!local&&(!base.startsWith('https://')||new URL(base).origin!==base)))throw new Error('APP_URL に自分の公開先の HTTPS origin を設定してください。');
mkdirSync('.data',{recursive:true,mode:0o700});
function execute(sql,read=false){const path=resolve('.data/owner-invite.sql');writeFileSync(path,sql,{mode:0o600});chmodSync(path,0o600);const result=spawnSync('npx',['wrangler','d1','execute',database,local?'--local':'--remote',...(read?['--command',sql]:['--file',path]),'--json'],{encoding:'utf8'});if(result.status!==0)throw new Error('登録リンクのDB処理に失敗しました。設定・接続を確認してください。');return d1Json(result.stdout);}
const results=execute("SELECT id FROM users WHERE role='owner' AND company_id='company';",true);
const exists=results.some(r=>r.results?.length);
if(exists&&!recover)throw new Error('全体管理者は登録済みです。本人の復旧には --recover を指定してください。');
if(!exists&&recover)throw new Error('復旧する全体管理者がいません。初回登録リンクを発行してください。');
const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),expires=Date.now()+48*3600000,now=new Date().toISOString();
execute(`UPDATE invitations SET revoked=1 WHERE role='owner' AND used_by IS NULL;
INSERT INTO invitations(token_hash,company_id,email,role,kind,target_id,expires,created_at)
${recover?`SELECT '${hash}',company_id,email,'owner','reset',id,${expires},'${now}' FROM users WHERE role='owner' AND company_id='company'`:`SELECT '${hash}','company',NULL,'owner','enroll',NULL,${expires},'${now}' WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='owner' AND company_id='company')`};`);
const link=base+'/join#token='+token,path=resolve(local?'.data/local-owner-registration.md':'.data/owner-registration.md');
writeFileSync(path,`# あなた専用の${recover?'復旧':'初回登録'}リンク\n\n[会社ダッシュボードを${recover?'再設定':'登録'}する](${link})\n\n有効期限：${new Date(expires).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}（日本時間）\n\n一度だけ使えます。このリンクを持つ人が全体管理者を登録できるため、他の人へ渡さないでください。\n\n${recover?'登録済みのメールアドレスと新しいパスワード':'表示名、自分のメールアドレス、新しいパスワード（12文字以上）'}を入力してください。Googleログインではなく、このツール専用のアカウントです。\n\n登録後は [会社ホーム](${base}/company) と [全体管理](${base}/owner) を利用できます。メンバーの招待は全体管理から行います。\n`,{mode:0o600});chmodSync(path,0o600);
console.log('専用リンクを保存しました：'+path);
