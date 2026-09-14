import test from 'node:test';
import assert from 'node:assert/strict';
import {presetRange,validRange} from '../lib/date-range.ts';
import {connected} from '../cloud/connected.ts';
import type {Env} from '../cloud/types.ts';
test('日・週・月の範囲は月曜始まりで年越し・閏年を処理する',()=>{assert.deepEqual(presetRange('week','2026-01-01'),{start:'2025-12-29',end:'2026-01-01'});assert.deepEqual(presetRange('lastMonth','2024-03-15'),{start:'2024-02-01',end:'2024-02-29'});assert.deepEqual(presetRange('day','2026-09-10'),{start:'2026-09-10',end:'2026-09-10'});assert.deepEqual(presetRange('lastWeek','2026-09-10'),{start:'2026-08-31',end:'2026-09-06'});assert.equal(validRange({start:'2026-02-29',end:'2026-03-01'}),false);assert.equal(validRange({start:'2026-09-11',end:'2026-09-10'}),false);});
test('SNS・UTAGEの保存済み記録を任意の日付範囲と事業で絞る',async()=>{const queries:{sql:string;args:unknown[]}[]=[];const env={DB:{prepare:(sql:string)=>{const q={sql,args:[] as unknown[]};queries.push(q);return{bind(...a:unknown[]){q.args=a;return this;},async all(){return{results:[]};}};}}} as unknown as Env;
 const r=await connected(new Request('https://test/api/marketing/connected?action=catalog&start=2025-01-01&end=2026-09-10'),env,'b1');assert.equal(r.status,200);assert.deepEqual(queries.find(q=>q.sql.includes('native_snapshots'))?.args,['b1','2025-01-01','2026-09-10']);assert.equal((await connected(new Request('https://test/api/marketing/connected?action=catalog&start=2026-02-29&end=2026-09-10'),env,'b1')).status,400);
});
