import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './helpers/analysis-session-fixture.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const name='原生Agent附件到项目：上传、解析、解读、最终正文与下载链接和页面同步';
if(process.env.BIDV4_CHAT_FIXTURE!=='1'&&process.env.BIDV4_CHAT_FULL_FIXTURE!=='1')test(name,{timeout:70000},()=>runIsolatedTest('chat-workflow.test.mjs','BIDV4_CHAT_FIXTURE',new RegExp(name),60000));
else if(process.env.BIDV4_CHAT_FIXTURE==='1')test(name,{timeout:50000},async()=>{
 const host=await analysisFixture();
 try{
  const result=await host.command('chatAnalysis');
  const errors=result.events.filter(e=>e.type==='tool/result'&&e.data.message.isError);assert.deepEqual(errors,[],JSON.stringify(errors));
  const task=result.tasks.tasks.find(t=>t.title==='对话上传验收');assert.ok(task);
  const state=await(await host.api('/page-flow/'+task.id)).json();assert.equal(state.execution.state,'completed');assert.equal(state.analysis_progress.reduce((n,p)=>n+p.done,0),8);
  const reply=result.events.findLast(e=>e.type==='assistant/message').data.message.content.find(b=>b.type==='text').text;
  assert.match(reply,/招标文件解读完成/);assert.match(reply,/本地目录验收 structure/);assert.match(reply,/workbench\/raw/);
  const document=await host.api('/workbench/raw?'+new URLSearchParams({task_id:task.id,path:'analysis/structure.md'}));assert.equal(document.status,200);assert.match(document.headers.get('content-disposition'),/attachment/);assert.match(await document.text(),/本地目录验收 structure/);
  assert.ok(result.events.some(e=>e.type==='user/message'&&e.data.content?.some(b=>b.type==='file')));
 }finally{await host.close()}
});

const fullName='原生Agent完整流程：上传、公司资料、制作、具体答复、审查和最终文件';
if(process.env.BIDV4_CHAT_FULL_FIXTURE!=='1'&&process.env.BIDV4_CHAT_FIXTURE!=='1')test(fullName,{timeout:160000},()=>runIsolatedTest('chat-workflow.test.mjs','BIDV4_CHAT_FULL_FIXTURE',new RegExp(fullName),150000));
else if(process.env.BIDV4_CHAT_FULL_FIXTURE==='1')test(fullName,{timeout:140000},async()=>{
 const host=await analysisFixture();
 try{
  const result=await host.command('chatFull');
  const errors=result.events.filter(e=>e.type==='tool/result'&&e.data.message.isError);assert.deepEqual(errors,[],JSON.stringify(errors));
  const task=result.tasks.tasks.find(t=>t.title==='对话全流程验收');assert.ok(task);
  const state=await(await host.api('/page-flow/'+task.id)).json();assert.equal(state.workflow.state,'completed',JSON.stringify(state.workflow));assert.equal(state.review.status,'reviewed');assert.equal(state.bidder.confirmed,true);
  const reply=result.events.findLast(e=>e.type==='assistant/message').data.message.content.find(b=>b.type==='text').text;assert.match(reply,/制作与审查已完成/);assert.match(reply,/artifacts\/[^/]+\/file/);
  assert.equal(state.session_id,result.sessionId);assert.equal(state.execution.session_id,result.sessionId);const evidence=await host.command('projectEvidence',{taskId:task.id});assert.deepEqual([...new Set(evidence.records.map(r=>r.session_id))],[result.sessionId]);assert.deepEqual(evidence.presets.filter(p=>p.id.startsWith('ooo-bidpliot')).map(p=>p.id),['ooo-bidpliot']);assert.ok(result.events.some(e=>e.type==='tool/call'&&e.data.name==='parse_document'));assert.ok(result.events.some(e=>e.type==='tool/call'&&e.data.name==='task'));
 }finally{await host.close()}
});
