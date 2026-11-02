import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,nodes,response} from './helpers/component-fixture.mjs';

const flow=(tid='t1')=>({task:{id:tid},execution:null,analysis_current:false,source_selection:{main:'原件.docx',supplements:[]},files:[{path:'analysis/structure.md'}],input_versions:{analyse:'v1'},volume_states:[],body_sections:[]});
const failed=(action_id='old')=>({action_id,kind:'analyse',state:'failed',error:'fixture failure',created_at:1,questions:[]});
const dismiss=(host,title)=>find(host,n=>n.props['aria-label']==='清除提示：'+title).props.onClick();

test('逐条清除同步清除角标和浮层，只影响当前条；相同操作再次失败仍提示',async()=>{
 const f=await fixture(async()=>response({}));let host,button;
 try{
  f.api.setNoticeScope('t1');f.api.reportError(new Error('依据读取失败'),{id:'t1:evidence',scope:'t1',title:'依据读取未完成'});f.api.reportError(new Error('other'),{id:'t2:evidence',scope:'t2',title:'其他项目'});f.api.openNoticeCenter();
  host=f.mount('TaskNoticeHost');button=f.mount('NoticeButton');dismiss(host,'依据读取未完成');
  assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['t2:evidence']);assert.equal(f.api.useTaskNotices().toast,null);assert.equal(nodes(button.render()).filter(n=>n.props.className==='ly-notice-count').length,0);
  f.api.reportError(new Error('依据读取失败'),{id:'t1:evidence',scope:'t1',title:'依据读取未完成'});assert.ok(f.api.useTaskNotices().items.some(n=>n.id==='t1:evidence'),'新的真实失败必须重新提示');
 }finally{host?.unmount();button?.unmount();f.close()}
});

test('清空当前项目同时清除错误和提醒，其他项目保留；轮询和切换不恢复旧提示',async()=>{
 const f=await fixture(async()=>response({}));let host;
 try{
  f.api.setNoticeScope('t1');f.api.syncExecutionNotices('t1',flow());f.api.reportExecution('t1',failed());f.api.reportError(new Error('other'),{id:'t2:error',scope:'t2'});f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');
  find(host,n=>n.type==='button'&&n.props.children==='清空当前项目').props.onClick();assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['t2:error']);
  f.api.setNoticeScope('t2');f.api.setNoticeScope('t1');f.api.syncExecutionNotices('t1',flow());f.api.reportExecution('t1',failed());assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['t2:error']);
  assert.equal(find(host,n=>n.type==='button'&&n.props.children==='清空当前项目').props.disabled,true);
 }finally{host?.unmount();f.close()}
});

test('清除提醒后同一状态不再出现，来源版本变化或问题解决后再次发生会重新提示',async()=>{
 const f=await fixture(async()=>response({}));let host;
 try{
  f.api.setNoticeScope('t1');f.api.syncExecutionNotices('t1',flow());f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');dismiss(host,'解读依据待核对');
  f.api.syncExecutionNotices('t1',flow());assert.deepEqual(f.api.useTaskNotices().items,[]);
  f.api.syncExecutionNotices('t1',{...flow(),input_versions:{analyse:'v2'}});assert.equal(f.api.useTaskNotices().items.length,1);dismiss(host,'解读依据待核对');
  f.api.syncExecutionNotices('t1',{...flow(),analysis_current:true});f.api.syncExecutionNotices('t1',flow());assert.equal(f.api.useTaskNotices().items.length,1);
 }finally{host?.unmount();f.close()}
});

test('失败执行手动清除不被重新进入恢复；新的失败执行仍显示，完成后自动清除',async()=>{
 const f=await fixture(async()=>response({}));let host;
 try{
  f.api.setNoticeScope('t1');f.api.reportExecution('t1',failed());f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');dismiss(host,'招标解读未完成');
  f.api.reportExecution('t1',failed());assert.deepEqual(f.api.useTaskNotices().items,[]);
  f.api.reportExecution('t1',failed('new'));assert.equal(f.api.useTaskNotices().items.length,1);
  f.api.syncExecutionNotices('t1',{...flow(),analysis_current:true,execution:{...failed('new'),state:'completed'}});assert.deepEqual(f.api.useTaskNotices().items,[]);
 }finally{host?.unmount();f.close()}
});

test('依据重试成功自动清除原错误，恢复后的同类失败可以再次记录',async()=>{
 let fail=true;const f=await fixture(async url=>url.includes('/page-flow/')?response({...flow(),task:{id:'t1',title:'项目'},analysis_progress:[],review:{bids:[]},body_files:[]}):url.includes('/workbench/content')?response(fail?{detail:'读取失败'}:{content:'本项目依据'},fail?503:200):response(url.includes('/artifacts?')?{artifacts:[]}:url.includes('/workbench?')?{files:[{path:'parse/原件.docx/原件.docx.md'}]}:{files:[]})),view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{
  await view.settle();const open=()=>find(view,n=>n.props.onEvidence).props.onEvidence('原件.docx（L1-L2）');
  await open();assert.ok(f.api.useTaskNotices().items.some(n=>n.id==='t1:evidence'));
  fail=false;await open();assert.ok(!f.api.useTaskNotices().items.some(n=>n.id==='t1:evidence'));
  fail=true;await open();assert.ok(f.api.useTaskNotices().items.some(n=>n.id==='t1:evidence'));
 }finally{view.unmount();f.close()}
});

test('后台项目读取失败清除后不被轮询加回；读取恢复后再次失败正常提示',async()=>{
 let fail=true;const f=await fixture(async url=>url.includes('/page-flow/')?response(fail?{detail:'暂时无法读取'}:{...flow(),analysis_current:true,task:{id:'t1',title:'项目'},analysis_progress:[],review:{bids:[]},body_files:[]},fail?503:200):response(url.includes('/artifacts?')?{artifacts:[]}:{files:[]})),view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});let host;
 try{
  f.api.setNoticeScope('t1');await view.settle();f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');dismiss(host,'项目读取未完成');
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.deepEqual(f.api.useTaskNotices().items,[]);assert.equal(f.api.useTaskNotices().toast,null);
  fail=false;window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  fail=true;window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.ok(f.api.useTaskNotices().items.some(n=>n.id==='t1:project-load'));
 }finally{host?.unmount();view.unmount();f.close()}
});
