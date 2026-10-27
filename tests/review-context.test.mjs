import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBatchResult} from '../server/native/review-context.mjs';

const batch={batch_id:'version:1',batch:2,total_batches:3,requirements:[{slot:1,tender:[{document_id:'tender',start:1,end:1,quote:'仅在另有要求时提交证明。'}]}]};
const receipt={role:'tool',content:[{type:'text',text:JSON.stringify({saved:true,next:batch})}]};

test('审核重复取下一批只在完整同版回执仍处于当前上下文时省去重复原文',()=>{
 const result=reviewBatchResult(batch,[receipt]);
 assert.equal(result.already_in_context,true);
 assert.equal(result.batch_id,batch.batch_id);
 assert.equal(result.requirements,undefined);
 const changed=structuredClone(batch);changed.requirements[0].tender[0].quote='新版本要求必须提交证明。';
 assert.equal(reviewBatchResult(changed,[receipt]),changed,'同batch_id的原文变化不能误复用');
 assert.equal(reviewBatchResult(batch,[]),batch,'历史已压缩移出时必须返回完整原文');
 assert.equal(reviewBatchResult(batch,[{role:'user',content:receipt.content}]),batch);
 assert.equal(reviewBatchResult(batch,[{role:'tool',content:[{type:'text',text:receipt.content[0].text.slice(0,30)+'[... tool result middle pruned ...]'}]}]),batch);
 const saved={batch_id:'version:0',saved_results:[{slot:1}]};
 assert.equal(reviewBatchResult(saved,[receipt]),saved,'旧批次更正仍能回读全部slot');
 const done={complete:true,accepted:9};assert.equal(reviewBatchResult(done,[receipt]),done);
});
