import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const name='自动全流程提问保存竞态：原生答复新轮早于旧flush返回仍同会话完成制作审查';
const flag='BIDV4_FULL_QUESTION_FLUSH_FIXTURE';
if(process.env[flag]!=='1')test(name,{timeout:100000},()=>runIsolatedTest('full-question-flush-race.test.mjs',flag,new RegExp(name),95000));
else test(name,{timeout:85000},async()=>{
 const host=await analysisFixture();
 try{
  const result=await host.command('fullQuestionFlushRace');assert.deepEqual(result.fixtureErrors,[]);
  assert.equal(result.during.oldSettled,false);assert.equal(result.during.agentStatus,'running');assert.ok(result.during.replyTurnSeq>result.during.boundary);
  assert.equal(result.state.workflow.state,'completed',JSON.stringify({during:result.during,workflow:result.state.workflow,execution:result.state.execution,updates:result.updates}));
  assert.deepEqual(result.state.workflow.completed,['analyse','outline','build','review']);assert.equal(result.state.review.status,'reviewed');assert.ok(result.state.volume_states.length>0);assert.ok(result.state.volume_states.every(volume=>volume.status==='ready'));
  assert.equal(result.state.session_id,result.sessionId);assert.deepEqual([...new Set(result.records.map(record=>record.session_id))],[result.sessionId]);assert.equal(result.records.length,4);assert.deepEqual(result.records.map(record=>record.kind).sort(),['analyse','build','outline','review']);
  assert.deepEqual(result.events.slice(0,result.prefix.length),result.prefix,'A native answer cannot rewrite the persisted question-turn history');assert.deepEqual(result.hashes,result.originalHashes);assert.equal(Object.keys(result.hashes).length,8);
  for(const record of result.upstream)assert.deepEqual(result.records.find(item=>item.action_id===record.action_id),record,'Later question and review turns must not rewrite completed upstream records');
  const build=result.records.find(record=>record.kind==='build'),review=result.records.find(record=>record.kind==='review');
  const updates=result.updates.filter(update=>update.actionId===build.action_id).map(update=>update.patch),paused=updates.find(patch=>patch.outcome?.state==='needs_input'),continued=updates.find(patch=>patch.outcome===null),finished=updates.findLast(patch=>patch.outcome?.state==='completed');
  assert.ok(paused,'The old turn must persist its captured needs_input outcome');assert.equal(paused.end_seq,undefined);assert.deepEqual(paused.outcome.questions.map(question=>question.callId),result.questions.map(question=>question.callId));
  assert.ok(continued,'The native answer must reclaim the same build action');assert.equal(continued.end_seq,null);assert.equal(continued.start_seq,result.during.replyTurnSeq);
  assert.ok(finished);assert.equal(build.start_seq,result.during.replyTurnSeq);assert.equal(build.outcome.state,'completed');assert.equal(build.end_seq,finished.end_seq);assert.ok(build.end_seq>result.during.boundary);assert.ok(build.end_seq<review.start_seq);assert.equal(review.outcome.state,'completed');
  assert.ok(result.events.some(event=>event.type==='user/message'&&event.data.source.kind==='user-question-reply'&&result.questions.some(question=>question.callId===event.data.source.callId)));
  assert.ok(result.events.some(event=>event.type==='tool/call'&&event.data.name==='finish_review_report'));assert.deepEqual(result.events.filter(event=>event.type==='tool/result'&&event.data.message.isError),[]);
  assert.equal(result.admissions,0);assert.equal(result.owners,0);assert.equal(result.settling,0);assert.equal(result.workflowStarts,0);assert.equal(result.workflowJobs,0);assert.deepEqual(result.locks,[]);
 }finally{await host.close()}
});
