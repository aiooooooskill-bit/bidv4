import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const name='审查有已保存进度时沿用同一执行自动接续，无进度时停止';
if(process.env.BIDV4_CONTINUATION_FIXTURE!=='1')test(name,{timeout:180000},()=>runIsolatedTest('review-continuation.test.mjs','BIDV4_CONTINUATION_FIXTURE',new RegExp(name),170000));
else test(name,{timeout:160000},async()=>{
 const host=await analysisFixture();
 try{
  for(const mode of ['progress','error']){
  await host.command('reviewEarlyEnd',{mode});
  const task=await host.command('fullWorkflow');
  const final=await host.command('nativeAnswer',{taskId:task.taskId});
  assert.equal(final.workflow.state,'completed',JSON.stringify(final.workflow));assert.equal(final.review.status,'reviewed');
  assert.deepEqual((await host.command('waitWorkflow',{taskId:task.taskId})).fixture_errors,[]);
  const evidence=await host.command('projectEvidence',{taskId:task.taskId});
  const review=evidence.records.find(r=>r.kind==='review');
  assert.equal(evidence.records.length,4,'Continuation retains the original review attempt');
  assert.equal(review.continuations,1);assert.equal(review.session_id,task.state.session_id);
  assert.equal(evidence.events.filter(e=>e.type==='tool/call'&&e.data.name==='prepare_review_documents').length,1,'Existing evidence and saved batches are reused');
  assert.equal(evidence.events.filter(e=>e.type==='tool/call'&&e.data.name==='finish_review_report').length,1);
  const read=evidence.events.findLast(e=>e.type==='tool/call'&&e.data.name==='ooo_bidpliot_read');
  const result=evidence.events.find(e=>e.type==='tool/result'&&e.data.message.toolCallId===read.data.callId);
  assert.equal(JSON.parse(result.data.message.content.find(c=>c.type==='text').text).report.completed,true,'The final report is readable inside the completing Agent turn');
  if(mode==='error')assert.ok(evidence.events.some(e=>e.type==='turn/end'&&e.data.reason.kind==='error'),'A real provider failure is recovered after durable progress');
  }
  await host.command('reviewEarlyEnd',{mode:'none'});
  const empty=await host.command('fullWorkflow');const failed=await host.command('nativeAnswer',{taskId:empty.taskId});
  assert.equal(failed.workflow.state,'failed');assert.equal(failed.execution.error,'本轮未生成有效审查报告');
  const stopped=await host.command('projectEvidence',{taskId:empty.taskId});assert.equal(stopped.records.find(r=>r.kind==='review').continuations,undefined);
  const count=await host.command('modelCount');await host.command('waitWorkflow',{taskId:empty.taskId});assert.equal(await host.command('modelCount'),count,'No empty-turn retry loop');
 }finally{await host.close()}
});
