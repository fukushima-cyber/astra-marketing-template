import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedText,BodyTooLarge} from '../cloud/bounded-body.ts';
test('本文を上限超過でキャンセルし、残りのストリームを全量読み込まない',async()=>{
 let reads=0,cancelled=false;
 const body=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(2048));},cancel(){cancelled=true;}},{highWaterMark:0});
 const r=new Request('https://test/join',{method:'POST',body,duplex:'half'} as RequestInit);
 await assert.rejects(boundedText(r,4000),BodyTooLarge);assert.equal(cancelled,true);assert.equal(reads,2);
});
test('UTF-8の分割文字を保持し、文字数ではなくバイト上限を検査',async()=>{
 const bytes=new TextEncoder().encode('日本語');let i=0;
 const r=new Request('https://test',{method:'POST',body:new ReadableStream({pull(c){if(i>=bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=1));}},{highWaterMark:0}),duplex:'half'} as RequestInit);
 assert.equal(await boundedText(r,9),'日本語');await assert.rejects(boundedText(new Request('https://test',{method:'POST',body:'日本語'}),8),BodyTooLarge);
});

