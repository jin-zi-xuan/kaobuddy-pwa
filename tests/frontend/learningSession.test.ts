import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreCardSession, nextCardRound } from '../../src/learningSession.ts';
const cards = [{id:'a',type:'concept' as const,front:'A',back:{answer:'A'}},{id:'b',type:'concept' as const,front:'B',back:{answer:'B'}}];
test('saved card round restores only for the same card content',()=>{
 const saved={signature:JSON.stringify(cards),queue:['b'],progress:{b:'uncertain' as const},round:2,index:0,flipped:true};
 assert.equal(restoreCardSession(cards,saved)?.round,2);
 assert.equal(restoreCardSession([{...cards[0],front:'changed'},cards[1]],saved),null);
 assert.equal(restoreCardSession(cards,{...saved,index:99}),null);
});
test('the last answer is included before deciding the next round',()=>{
 const result=nextCardRound(cards,{a:'mastered',b:'unknown'},'b','mastered');
 assert.deepEqual(result.weak,[]); assert.equal(result.mastered,2);
 const failed=nextCardRound(cards,{a:'mastered',b:'mastered'},'b','uncertain');
 assert.deepEqual(failed.weak.map(c=>c.id),['b']);
});
