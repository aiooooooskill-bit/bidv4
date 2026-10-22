import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,find,questionInput,response} from './helpers/component-fixture.mjs';
import {deliveryReady,actionSatisfied} from '../shared/delivery-status.js';
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
const complete=()=>({directory:{content:{response_documents:[]}},body_sections:[{volume:'技术',title:'方案',path:'body/方案.docx',status:'ready',modified_at:200}],body_files:['body/方案.docx'],build_preparation:{guide:'ready',promises:'ready'},volume_states:[{name:'技术',status:'ready'}],files:[{path:'body/写作指引.md',modified_at:200}],input_versions:{},review:{},bidder:{confirmed:true}});
const failed=(kind,id=kind)=>({kind,session_id:'same-session',action_id:id,created_at:100,state:'failed',error:'虚构失败',questions:[]});

test('delivery requires verified current sections, not just generated files and a volume',()=>{
 const flow=complete();assert.ok(deliveryReady(flow));
 for(const state of ['stale','unverified','draft','missing']){flow.body_sections[0].status=state;assert.equal(deliveryReady(flow),false)}
});

test('manual and native Agent repairs resolve only stages with current evidence',()=>{
 const flow=complete();assert.ok(actionSatisfied(flow,failed('build')));assert.ok(actionSatisfied(flow,failed('guide')));
 assert.equal(actionSatisfied(flow,failed('review')),false);
 const revise={...failed('revise'),sections:[{volume:'技术',title:'方案'}]};assert.ok(actionSatisfied(flow,revise));
 revise.created_at=300;assert.equal(actionSatisfied(flow,revise),false,'existing old ready section cannot resolve a newer failed revision');
 flow.build_preparation.guide='stale';assert.equal(actionSatisfied(flow,failed('build')),false);
});

test('failed action history can coexist with completed delivery without contradictory build failure',async()=>{
 const flow=complete();flow.execution={...failed('build'),resolved:true};
 const f=await fixture(async()=>{throw Error('No network expected')}),view=f.mount('BuildWorkspace',{tid:'t',flow,mode:'build',input:questionInput(),artifacts:[],onChanged:async()=>{}});
 try{
  assert.equal(text(find(view,n=>n.props.className==='build-status-execution')),'标书已制作');
  assert.doesNotMatch(text(view.render()),/制作未完成|制作与合册未完成/);
  flow.execution=failed('review');assert.match(text(view.render()),/标书审查未完成/);assert.doesNotMatch(text(view.render()),/制作未完成/);
 }finally{view.unmount();f.close()}
});

test('same-session errors are scoped by action and resolve only when their own stage is repaired',async()=>{
 const f=await fixture(async()=>{throw Error('No network expected')});
 try{
  const flow=complete();flow.build_preparation.guide='missing';flow.volume_states[0].status='missing';
  const build=failed('build'),review=failed('review'),other=failed('build','foreign');
  f.api.reportExecution('t',build);f.api.reportExecution('t',review);f.api.reportExecution('foreign',other);
  assert.equal(f.api.useTaskNotices().items.length,3,'same session can contain independent failed actions');
  flow.execution={...failed('guide','new-guide'),state:'completed'};flow.build_preparation.guide='ready';
  f.api.syncExecutionNotices('t',flow);assert.equal(f.api.useTaskNotices().items.length,3,'unrelated guide success cannot resolve build or review failure');
  flow.volume_states[0].status='ready';flow.execution={...build,resolved:true};f.api.syncExecutionNotices('t',flow);
  assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.execution.kind),['review','build']);
  flow.execution={...review,action_id:'new-review',state:'completed'};f.api.syncExecutionNotices('t',flow);
  assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.scope),['foreign']);
 }finally{f.close()}
});

test('HTTP build submission error clears after actual delivery, not unrelated preparation success',async()=>{
 const flow={...complete(),task:{id:'t',title:'虚构回归项目'},source_selection:{main:'虚构.docx',supplements:[]},session_id:'fictional',workflow:null,review:{bids:[]},input_versions:{analyse:'a',build:'b'}};
 flow.volume_states[0].status='missing';
 const f=await fixture(async(url,options={})=>response(url.endsWith('/action')?{detail:'虚构502提交失败'}:url.includes('/page-flow/')?flow:url.includes('/artifacts')?{artifacts:[]}:{files:[]},url.endsWith('/action')?502:200));
 const view=f.mount('ProjectWorkbench',{tid:'t',mode:'build',onBack(){},onMode(){}});
 try{
  await view.settle();
  const workspace=find(view,n=>n.props.execute&&n.props.exportVolume);
  assert.equal(await workspace.props.execute('build'),false);await view.settle();
  assert.equal(f.api.useTaskNotices().items.length,1);
  assert.equal(f.api.useTaskNotices().items[0].submission.kind,'build');
  f.api.reportError(new Error('虚构审核提交失败'),{id:'t:page-action:review',scope:'t',submission:{kind:'review',created_at:Date.now()}});
  f.api.reportError(new Error('另一项目错误'),{id:'other:page-action:build',scope:'other',submission:{kind:'build',created_at:Date.now()}});
  flow.execution={...failed('guide','new-guide'),state:'completed'};
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  assert.equal(f.api.useTaskNotices().items.length,3,'Guide success cannot resolve incomplete build submission');
  flow.volume_states[0].status='ready';
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['t:page-action:review','other:page-action:build']);
 }finally{view.unmount();f.close()}
});

test('submission recovery requires a newer matching action or updated selected sections',async()=>{
 const f=await fixture(async()=>{throw Error('No network expected')});
 try{
  const flow=complete();
  f.api.reportError(new Error('虚构修改失败'),{id:'t:page-action:revise',scope:'t',submission:{kind:'revise',created_at:300,sections:[{volume:'技术',title:'方案'}]}});
  f.api.reportError(new Error('虚构目录提交失败'),{id:'t:page-action:outline',scope:'t',submission:{kind:'outline',created_at:300}});
  flow.execution={...failed('outline','old-success'),created_at:200,state:'completed'};
  f.api.syncExecutionNotices('t',flow);assert.equal(f.api.useTaskNotices().items.length,2,'Old valid files and old success cannot erase a new attempt');
  flow.body_sections[0].modified_at=400;
  f.api.syncExecutionNotices('t',flow);assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['t:page-action:outline']);
  flow.execution={...flow.execution,created_at:400};
  f.api.syncExecutionNotices('t',flow);assert.equal(f.api.useTaskNotices().items.length,0);
 }finally{f.close()}
});

test('lost-response retries preserve first submission time and resolve against the admitted action',async()=>{
 const flow={...complete(),task:{id:'t',title:'虚构重试项目'},source_selection:{main:'虚构.docx',supplements:[]},workflow:null,execution:null,review:{bids:[]},input_versions:{guide:'same-basis',outline:'outline-basis'}};
 const requests=[];
 const f=await fixture(async(url,options={})=>{
  if(url.endsWith('/action')){requests.push(JSON.parse(options.body));throw new TypeError('Failed to fetch')}
  return response(url.includes('/page-flow/')?flow:url.includes('/artifacts')?{artifacts:[]}:{files:[]});
 });
 const view=f.mount('ProjectWorkbench',{tid:'t',mode:'build',onBack(){},onMode(){}});
 const originalNow=Date.now;let now=1000;Date.now=()=>now;
 try{
  await view.settle();
  const execute=()=>find(view,n=>n.props.execute&&n.props.exportVolume).props.execute;
  await execute()('guide');await view.settle();
  assert.equal(f.api.useTaskNotices().items[0].submission.created_at,1000);
  now=3000;await execute()('guide');await view.settle();
  assert.equal(requests[0].request_id,requests[1].request_id,'Network retry must reuse request identity');
  assert.equal(f.api.useTaskNotices().items[0].submission.created_at,1000,'Same request retains its first submission time');
  const admittedId=createHash('sha256').update(requests[0].request_id).digest('hex');
  flow.execution={...failed('guide',admittedId),created_at:1100,state:'completed'};
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  assert.equal(f.api.useTaskNotices().items.length,0,'Original admitted success resolves the lost-response retry');
  now=4000;await execute()('outline');await view.settle();
  assert.notEqual(requests[1].request_id,requests[2].request_id,'Different intent starts a new request');
  assert.equal(f.api.useTaskNotices().items[0].submission.created_at,4000);
  flow.execution={...failed('outline','old-outline'),created_at:3500,state:'completed'};
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  assert.equal(f.api.useTaskNotices().items.length,1,'Old success cannot clear the different, newer submission');
  flow.execution={...flow.execution,created_at:4100};
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();
  assert.equal(f.api.useTaskNotices().items.length,0);
 }finally{Date.now=originalNow;view.unmount();f.close()}
});
