import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const name='同一自动全流程连续两次原生问答：不同保存任务均接续、同会话完成制作审查';
const flag='BIDV4_FULL_QUESTION_REPEAT_FIXTURE';
if(process.env[flag]!=='1')test(name,{timeout:100000},()=>runIsolatedTest('full-question-repeat.test.mjs',flag,new RegExp(name),95000));
else test(name,{timeout:85000},async()=>{
 const host=await analysisFixture();
 try{
  const result=await host.command('fullQuestionRepeat');assert.deepEqual(result.fixtureErrors,[]);
  assert.equal(result.rounds.length,2);assert.equal(result.distinctSettlements,2,'Each answer must resume a different actual settlement, rather than coalescing both into one');
  const questionIds=result.rounds.flatMap(round=>round.questions.map(question=>question.callId));assert.equal(questionIds.length,2);assert.equal(new Set(questionIds).size,2);
  assert.deepEqual(result.rounds.flatMap(round=>round.questions.flatMap(question=>question.questions.map(item=>item.id))),['term','delivery']);
  for(const round of result.rounds){
   assert.equal(round.during.oldSettled,false);assert.equal(round.during.agentStatus,'running');assert.ok(round.during.replyTurnSeq>round.during.boundary);
   assert.equal(round.settled.state,'needs_input');assert.deepEqual(round.settled.questions.map(question=>question.callId),round.questions.map(question=>question.callId));
   assert.deepEqual(result.events.slice(0,round.prefix.length),round.prefix,'Each persisted question-turn prefix remains unchanged');
  }
  assert.ok(result.rounds[0].during.replyTurnSeq<result.rounds[1].during.boundary);
  assert.equal(result.state.workflow.state,'completed',JSON.stringify({workflow:result.state.workflow,execution:result.state.execution,rounds:result.rounds.map(round=>({during:round.during,settled:round.settled}))}));assert.deepEqual(result.state.workflow.completed,['analyse','outline','build','review']);assert.equal(result.state.review.status,'reviewed');assert.ok(result.state.volume_states.length>0);assert.ok(result.state.volume_states.every(volume=>volume.status==='ready'));
  assert.equal(result.state.session_id,result.sessionId);assert.equal(result.records.length,4);assert.deepEqual(result.records.map(record=>record.kind).sort(),['analyse','build','outline','review']);assert.deepEqual([...new Set(result.records.map(record=>record.session_id))],[result.sessionId]);
  const replies=result.events.filter(event=>event.type==='user/message'&&event.data.source.kind==='user-question-reply');assert.equal(replies.length,2);assert.deepEqual(replies.map(event=>event.data.source.callId),questionIds);
  assert.deepEqual(result.hashes,result.originalHashes);assert.equal(Object.keys(result.hashes).length,8);for(const record of result.upstream)assert.deepEqual(result.records.find(item=>item.action_id===record.action_id),record);
  const build=result.records.find(record=>record.kind==='build'),review=result.records.find(record=>record.kind==='review'),updates=result.updates.filter(update=>update.actionId===build.action_id).map(update=>update.patch);
  assert.equal(updates.filter(patch=>patch.outcome?.state==='needs_input').length,2);assert.deepEqual(updates.filter(patch=>patch.outcome===null).map(patch=>patch.start_seq),result.rounds.map(round=>round.during.replyTurnSeq));assert.equal(build.start_seq,result.rounds[1].during.replyTurnSeq);assert.equal(build.outcome.state,'completed');assert.ok(build.end_seq>result.rounds[1].during.boundary);assert.ok(build.end_seq<review.start_seq);assert.equal(review.outcome.state,'completed');
  assert.ok(result.events.some(event=>event.type==='tool/call'&&event.data.name==='finish_review_report'));assert.deepEqual(result.events.filter(event=>event.type==='tool/result'&&event.data.message.isError),[]);
  assert.equal(result.admissions,0);assert.equal(result.owners,0);assert.equal(result.settling,0);assert.equal(result.workflowStarts,0);assert.equal(result.workflowJobs,0);assert.equal(result.workflowResumptions,0);assert.deepEqual(result.locks,[]);
 }finally{await host.close()}
});
