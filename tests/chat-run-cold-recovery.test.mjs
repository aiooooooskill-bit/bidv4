import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';

const name='原生冷恢复新轮run：旧目录崩溃后同会话发布、有效解读和草稿不改写、旧执行不冒充完成';
const flag='BIDV4_CHAT_COLD_FIXTURE';
function startHost(){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.DSH_TOOLS_MODE;
 const child=fork(join(root,'tests/helpers/cold-run-host.mjs'),[],{env,cwd:root,stdio:['ignore','pipe','pipe','ipc']});
 let output='',stopped=false;const pending=new Map(),ready=Promise.withResolvers();
 child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 child.on('message',message=>{if(message.ready){ready.resolve(message.result);return}const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.stack)):request.resolve(message.result)}});
 child.on('error',error=>ready.reject(error));
 child.on('exit',code=>{stopped=true;const error=new Error('Cold fixture host exited '+code+'\n'+output.replace(/([?&]token=)[^\s)]+/g,'$1[redacted]'));ready.reject(error);for(const request of pending.values()){clearTimeout(request.timer);request.reject(error)}pending.clear()});
 const command=(command,args)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Cold fixture '+command+' timed out\n'+output))},25000);pending.set(id,{resolve,reject,timer});child.send({id,command,args})});
 return {ready:ready.promise,command,async kill(){if(stopped)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited},async close(){if(stopped)return;try{await command('close');if(!stopped)await new Promise(resolve=>child.once('exit',resolve));assert.doesNotMatch(output,/flush on a closed handle|best-effort final session flush failed|session-persistence: final drain[^\n]*failed/)}finally{if(!stopped)child.kill('SIGKILL')}}};
}
const resultFor=(events,id)=>events.find(event=>event.type==='tool/result'&&event.data.message.toolCallId===id)?.data.message;
if(process.env[flag]!=='1')test(name,{timeout:100000},()=>runIsolatedTest('chat-run-cold-recovery.test.mjs',flag,new RegExp(name),95000));
else test(name,{timeout:85000},async()=>{
 let host;
 try{
  host=startHost();assert.equal((await host.ready).modelRequests,0);
  const checkpoint=await host.command('seed');assert.deepEqual(checkpoint.fixtureErrors,[]);
  assert.equal(checkpoint.completedAnalysis.state.execution.state,'completed');assert.equal(checkpoint.state.execution.state,'running');assert.equal(checkpoint.state.execution.kind,'outline');
  const orphanId=checkpoint.state.execution.action_id,orphan=checkpoint.records.find(record=>record.action_id===orphanId);
  assert.equal(orphan.end_seq,undefined);assert.equal(orphan.outcome,undefined);assert.equal(checkpoint.records.length,2);assert.equal(Object.keys(checkpoint.files).length,9);
  assert.equal(resultFor(checkpoint.events,'cold-outline-original').isError,false);assert.equal(resultFor(checkpoint.events,'cold-outline-draft').isError,false);
  assert.equal(checkpoint.events.findLast(event=>event.type==='turn/end')?.data.reason.kind,'completed','The previous analyse completed normally');
  assert.ok(checkpoint.events.findLast(event=>event.type==='turn/start').seq>checkpoint.events.findLast(event=>event.type==='turn/end').seq,'The persisted outline turn must still be open at SIGKILL');
  await host.kill();host=startHost();assert.equal((await host.ready).modelRequests,0);
  const opened=await host.command('open',{taskId:checkpoint.taskId,sessionId:checkpoint.sessionId});
  assert.equal(opened.modelRequests,0,'Opening the original native conversation must not dispatch a model');assert.equal(opened.sessionId,checkpoint.sessionId);assert.equal(opened.state.session_id,checkpoint.sessionId);assert.equal(opened.records.length,2);assert.deepEqual(opened.files,checkpoint.files);assert.deepEqual(opened.events.slice(0,checkpoint.events.length),checkpoint.events,'SIGKILL recovery must retain every real persisted event');
  const resumed=await host.command('continue',{orphanActionId:orphanId});assert.deepEqual(resumed.fixtureErrors,[]);
  const run=resultFor(resumed.events,'cold-outline-resume');assert.ok(run,'The new native turn must produce an actual run tool/result');assert.equal(run.isError,false,JSON.stringify(run));assert.match(JSON.stringify(run),/本轮目录派发\/汇总契约/);
  assert.equal(resumed.state.execution.kind,'outline');assert.equal(resumed.state.execution.state,'completed');assert.equal(resumed.state.session_id,checkpoint.sessionId);assert.ok(resumed.state.directory);
  assert.notEqual(resumed.state.execution.action_id,orphanId);assert.equal(resumed.records.length,3);assert.deepEqual(resumed.records.map(record=>record.kind).sort(),['analyse','outline','outline']);assert.deepEqual([...new Set(resumed.records.map(record=>record.session_id))],[checkpoint.sessionId]);
  assert.deepEqual(resumed.files,checkpoint.files,'The explicit new run must read and reuse all eight valid analysis files and the existing directory draft');
  assert.deepEqual(resumed.events.slice(0,checkpoint.events.length),checkpoint.events);
  const newEvents=resumed.events.slice(opened.events.length);assert.equal(newEvents.findLast(event=>event.type==='turn/end').data.reason.kind,'completed');assert.deepEqual(newEvents.filter(event=>event.type==='tool/result'&&event.data.message.isError),[]);
  assert.ok(resultFor(newEvents,'cold-draft-read'));assert.ok(resultFor(newEvents,'cold-outline-publish'));assert.ok(!newEvents.some(event=>event.type==='tool/call'&&event.data.name==='write'),'The new turn must not blindly rewrite the retained draft');
  assert.equal(resumed.orphanExecution.state,'failed','Later successful turns cannot change the orphan action execution boundary');assert.equal(resumed.orphanProjection.state,'failed','The original crashed action remains failed after the replacement action completes');
  const completedAnalysis=resumed.records.find(record=>record.kind==='analyse');assert.equal(completedAnalysis.outcome.state,'completed');assert.ok(completedAnalysis.end_seq<orphan.start_seq);
  assert.equal(resumed.admissions,0);assert.equal(resumed.settling,0);assert.deepEqual(resumed.locks,[]);assert.equal(resumed.modelRequests,6,'Only the explicit continuation runs after restart');
 }finally{await host?.close()}
});
