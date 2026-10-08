// Optional local UI test: PLAYWRIGHT_MODULE can point to the installed Playwright ESM module.
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.TEST_BASE??'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'This test creates local-only accounts');
const browser=await chromium.launch({channel:'chrome',headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));mkdirSync('.data',{recursive:true});
try{
 if(process.env.ENROLL_LOCAL_OWNER==='1'){
 const link=readFileSync('.data/local-owner-registration.md','utf8').match(/http[^)]+/)[0];
 await page.goto(link);await page.getByLabel('表示名',{exact:true}).fill('検証用オーナー');await page.getByLabel('メールアドレス',{exact:true}).fill('local-owner@example.test');await page.getByLabel('パスワード',{exact:true}).fill('local-owner-test-password');await page.getByLabel('パスワード（確認）',{exact:true}).fill('local-owner-test-password');await page.getByRole('button',{name:'登録・再設定して開く',exact:true}).click();
 }else{await page.goto(base+'/login');await page.getByLabel('メールアドレス',{exact:true}).fill('local-owner@example.test');await page.getByLabel('パスワード',{exact:true}).fill('local-owner-test-password');await page.getByRole('button',{name:'ログイン',exact:true}).click();}
 await page.waitForURL('**/company');await page.getByRole('heading',{name:'事業別の実績',exact:true}).waitFor();
 await page.screenshot({path:'.data/company-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'全体管理',exact:true}).click();await page.getByRole('heading',{name:'メンバーと権限',exact:true}).waitFor();
 const stamp=Date.now(),email='local-member-'+stamp+'@example.test',memberName='検証用投稿担当'+stamp;
 await page.getByLabel('メールアドレス',{exact:true}).fill(email);
 await page.getByRole('checkbox',{name:'コンテンツ販売 SNS投稿を閲覧',exact:true}).check();
 await page.getByRole('button',{name:'この人に見える範囲を確認',exact:true}).click();
 await page.screenshot({path:'.data/owner-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'この内容で招待リンクを発行',exact:true}).click();
 await page.getByRole('heading',{name:'本人へ渡すリンク',exact:true}).waitFor();const invite=await page.locator('a.co-link').getAttribute('href');
 const memberCtx=await browser.newContext(),member=await memberCtx.newPage();
 await member.goto(invite);await member.getByLabel('表示名',{exact:true}).fill(memberName);await member.getByLabel('メールアドレス',{exact:true}).fill(email);await member.getByLabel('パスワード',{exact:true}).fill('local-member-test-password');await member.getByLabel('パスワード（確認）',{exact:true}).fill('local-member-test-password');await member.getByRole('button',{name:'登録・再設定して開く',exact:true}).click();await member.waitForURL('**/company');
 await member.getByRole('heading',{name:'事業別の実績',exact:true}).waitFor();assert.equal(await member.getByRole('link',{name:'全体管理',exact:true}).count(),0);
 await member.goto(base+'/marketing');await member.getByRole('heading',{name:'投稿一覧・作成',exact:true}).waitFor();
 assert.equal(await member.getByRole('button',{name:'詳細分析',exact:true}).count(),0);assert.equal(await member.getByRole('button',{name:'＋ 事業を追加',exact:true}).count(),0);
 await member.getByText('閲覧のみの権限です。保存・変更はできません。',{exact:true}).waitFor();
 assert.equal(await member.evaluate(async()=> (await fetch('/api/owner')).status),403);assert.equal(await member.evaluate(async()=> (await fetch('/api/marketing/analytics')).status),403);
 await page.getByRole('button',{name:'再取得',exact:true}).click();await page.getByRole('button',{name:new RegExp(memberName)}).click();
 await page.getByRole('checkbox',{name:'このメンバーの利用を有効にする',exact:true}).uncheck();await page.getByRole('button',{name:'この人に見える範囲を確認',exact:true}).click();await page.getByRole('button',{name:'この内容で保存',exact:true}).click();
 await page.getByText('保存しました。権限を変えたメンバーは再ログインが必要です。',{exact:true}).waitFor();assert.equal(await member.evaluate(async()=> (await fetch('/api/me')).status),401);
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/company');await page.getByRole('heading',{name:'事業別の実績',exact:true}).waitFor();await page.screenshot({path:'.data/company-mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page-wide horizontal overflow');assert.deepEqual(errors,[]);
 console.log('PASS: owner enrollment/login, company home, permission preview/invitation, member navigation/API restrictions, revocation, 390px layout');
}finally{await browser.close();}
