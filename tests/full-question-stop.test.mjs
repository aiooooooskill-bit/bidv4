import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const name='自动全流程原生答复后停止：已写正文保留、续跑队列不得自动重发制作或审查';
const flag='BIDV4_FULL_QUESTION_STOP_FIXTURE';
if(process.env[flag]!=='1')test(name,{timeout:100000},()=>runIsolatedTest('full-question-stop.test.mjs',flag,new RegExp(name),95000));
else test(name,{timeout:85000},async()=>{
 const host=await analysisFixture();
 try{
  const result=await host.command('fullQuestionStop');assert.deepEqual(result.fixtureErrors,[]);
  assert.equal(result.state.workflow.state,'stopped',JSON.stringify({workflow:result.state.workflow,execution:result.state.execution,records:result.records.map(record=>({kind:record.kind,action_id:record.action_id,outcome:record.outcome}))}));assert.equal(result.state.execution.state,'stopped');assert.equal(result.state.execution.kind,'build');assert.equal(result.state.review.status,'unreviewed');
  assert.equal(result.records.length,3);assert.deepEqual(result.records.map(record=>record.kind).sort(),['analyse','build','outline']);assert.deepEqual([...new Set(result.records.map(record=>record.session_id))],[result.sessionId]);assert.equal(result.state.session_id,result.sessionId);
  assert.equal(result.requestsAfterDrain,result.requestsAtStop,'Pending resumeAfter must not issue another model request after native Stop');assert.ok(!result.events.some(event=>event.type==='tool/call'&&event.data.name==='finish_review_report'));
  assert.deepEqual(result.events.slice(0,result.prefix.length),result.prefix);assert.deepEqual(result.hashes,result.originalHashes);assert.equal(Object.keys(result.hashes).length,8);assert.equal(result.bodyHash,result.savedBodyHash,'The body child wrote a real durable DOCX before cancellation, and Stop must retain it');assert.match(result.bodyHash,/^[a-f0-9]{64}$/);
  assert.ok(result.events.some(event=>event.type==='user/message'&&event.data.source.kind==='user-question-reply'));assert.equal(result.events.findLast(event=>event.type==='turn/end').data.reason.kind,'aborted');
  const build=result.records.find(record=>record.kind==='build');assert.equal(build.outcome.state,'stopped');assert.ok(build.end_seq>build.start_seq);
  assert.equal(result.admissions,0);assert.equal(result.owners,0);assert.equal(result.settling,0);assert.equal(result.workflowStarts,0);assert.equal(result.workflowJobs,0);assert.equal(result.workflowResumptions,0);assert.deepEqual(result.locks,[]);
 }finally{await host.close()}
});
