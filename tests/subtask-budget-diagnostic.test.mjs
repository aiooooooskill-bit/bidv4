import test from 'node:test';
import assert from 'node:assert/strict';
import {subagentFailure} from '../server/native/subtasks.mjs';

test('durable max-token exit explains preservation and smaller continuation',async()=>{
 let disposed=false;
 const ctx={sessionQuery:{async observeSession(){return {events:[{type:'turn/end',data:{reason:{kind:'max-tokens'}}}],[Symbol.dispose](){disposed=true}}}}};
 const error=await subagentFailure(ctx,{childId:'child'},{},'子任务未完成');
 assert.match(error.message,/输出预算已耗尽/);
 assert.match(error.message,/已保存成果/);
 assert.match(error.message,/不重复整项制作/);
 assert.equal(disposed,true);
});
