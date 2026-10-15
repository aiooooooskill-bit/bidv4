import test from 'node:test';
import {rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
const name='智能解读接入原生会话：同一执行、实时工具和回复、刷新历史、冷回看';
const waitUntil=async operation=>{const end=Date.now()+20000;while(Date.now()<end){if(await operation())return;await new Promise(resolve=>setTimeout(resolve,80))}throw Error('fixture condition timed out')};
if(process.env.BIDV4_ANALYSIS_FIXTURE!=='1')test(name,{timeout:110000},()=>runIsolatedTest('analysis-sessions.test.mjs','BIDV4_ANALYSIS_FIXTURE',new RegExp(name),100000));
else test(name,{timeout:95000},async()=>{
 let host=await analysisFixture(),retainedHome;
 try{
  const reloaded=await host.command('reload');assert.equal(reloaded.active,true,JSON.stringify(reloaded.logs));
  const {taskId,sessionId}=await host.command('analysisStart');
  await waitUntil(async()=> (await host.command('analysisState')).streaming);
  const before=await host.command('nativeEvidence',{sessionId});assert.equal(before.sameAgent,true,'Native Chat must observe the actual business Agent');
  const list=await host.command('nativeList');assert.ok(list.items.some(row=>row.sessionId===sessionId&&row.running));
  const snapshot=await host.command('nativeFollow',{key:'live',sessionId,maxMessages:1});
  assert.equal(snapshot.type,'snapshot');assert.equal(snapshot.header.id,sessionId);assert.ok(snapshot.hasMore);
  assert.ok(snapshot.assistantStream,'Native stream carries the active partial response');
  let records=snapshot.records;
  while(records[0].event.seq>0){
   const page=await host.command('nativePage',{address:{kind:'session',sessionId},throughSeq:snapshot.cursor,beforeSeq:records[0].event.seq,maxMessages:1});
   assert.ok(page.records.length);records=[...page.records,...records];if(!page.hasMore)break;
  }
  const events=records.map(r=>r.event);
  assert.ok(events.some(e=>e.type==='user/message'));assert.ok(events.some(e=>e.type==='tool/call'&&e.data.name==='parse_document'));assert.ok(events.some(e=>e.type==='tool/result'));
  assert.equal(new Set(events.map(e=>e.seq)).size,events.length);
  assert.deepEqual(events,before.events,'Native history is the original event log, without copied or fabricated messages');
  await host.command('nativeClose',{key:'live'});
  const refresh=await host.command('nativeFollow',{key:'refresh',sessionId,maxMessages:1});assert.deepEqual(refresh.records,snapshot.records);assert.deepEqual(refresh.assistantStream,snapshot.assistantStream);
  assert.deepEqual(await host.command('nativeEvidence',{sessionId}),before,'Viewing and refreshing must not run a model or change execution events');
  const completed=await host.command('analysisRelease');assert.equal(completed.state.state,'completed');
  let terminal=false,partial=false;
  while(!terminal){const frame=await host.command('nativeNext',{key:'refresh'});if(frame.type==='assistant-stream')partial=true;if(frame.type==='event'&&frame.event.type==='turn/end')terminal=true}
  assert.ok(partial,'Native follow must receive final streamed text');
  const final=await host.command('nativeEvidence',{sessionId});assert.ok(final.events.some(e=>e.type==='assistant/message'&&JSON.stringify(e).includes('已读取原件，正在整理八份解读文件。')));
  assert.equal((await(await host.api('/page-flow/'+taskId)).json()).session_id,sessionId);
  await host.command('nativeClose',{key:'refresh'});
  const home=host.home;retainedHome=home;await host.close(true);host=await analysisFixture(home);
  const cold=await host.command('nativeFollow',{key:'cold',sessionId});assert.equal(cold.type,'snapshot');
  const retained=await host.command('nativeEvidence',{sessionId});assert.deepEqual(retained.events,final.events);assert.equal(retained.modelRequests,0);assert.equal(retained.handles,0);
  await host.command('nativeClose',{key:'cold'});
 }finally{await host.close();if(retainedHome)await rm(retainedHome,{recursive:true,force:true})}
});
