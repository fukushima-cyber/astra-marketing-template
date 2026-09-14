import type {Env} from './types.ts';
import {can,type Identity} from '../lib/access.ts';
export async function advertisingEvidence(env:Env,user:Identity,scope:string,start:string,end:string){
 if(!can(user,scope,'ads'))return {available:false,note:'広告運用の閲覧権限がないため参照しません。'};
 const accounts=(await env.DB.prepare('SELECT id,name,currency,timezone,last_sync FROM ad_accounts WHERE business_id=?').bind(scope).all()).results;
 const rows=(await env.DB.prepare('SELECT r.account_id,r.data FROM ad_reports r JOIN ad_accounts a ON a.id=r.account_id WHERE a.business_id=? AND r.day>=? AND r.day<=? ORDER BY r.day,r.ad_id LIMIT 2001').bind(scope,start,end).all<{account_id:string;data:string}>()).results;
 if(rows.length>2000)return {available:false,note:'広告の実績が多いため診断の観測日数を短くしてください。広告の実績は今回の入力には含みません。'};
 return {available:true,accounts,rows:rows.map(r=>({accountId:r.account_id,...JSON.parse(r.data)})),note:'Meta広告側の計測条件による実績。UTAGEや手動実績と同じ成果を重複計上しない。金額は各アカウント通貨、日付は各アカウント時間帯。異なる通貨を合算しない。'};
}
