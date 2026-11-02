import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,response} from './helpers/component-fixture.mjs';

for(const ending of ['success','failure'])test(`项目A重试${ending}等待中，项目B仍可逐条清除及清空`,async()=>{
 const gate=Promise.withResolvers();let reject=false;const f=await fixture(async()=>response({}));let host;
 try{
  f.api.setNoticeScope('A');f.api.reportError(new Error('A failure'),{id:'A:load',scope:'A',title:'A读取失败',retry:async()=>{await gate.promise;if(reject)throw new Error('A retry failed')}});f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');
  find(host,n=>n.type==='button'&&n.props.children==='重新读取').props.onClick();host.render();
  // The real host component survives closing the drawer and switching projects.
  find(host,n=>n.props['aria-label']==='关闭操作提示').props.onClick();
  f.api.setNoticeScope('B');f.api.reportError(new Error('B failure'),{id:'B:error',scope:'B',title:'B操作失败'});f.api.openNoticeCenter();
  const single=find(host,n=>n.props['aria-label']==='清除提示：B操作失败'),all=find(host,n=>n.type==='button'&&n.props.children==='清空当前项目');
  assert.notEqual(single.props.disabled,true,'项目A重试的busy状态不应禁用项目B的手动清除');
  assert.equal(all.props.disabled,false,'当前项目清空不应依赖其他项目的请求');
  single.props.onClick();assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['A:load']);
  f.api.reportError(new Error('another B failure'),{id:'B:second',scope:'B',title:'B第二次失败'});
  find(host,n=>n.type==='button'&&n.props.children==='清空当前项目').props.onClick();assert.deepEqual(f.api.useTaskNotices().items.map(n=>n.id),['A:load']);
  reject=ending==='failure';gate.resolve();await host.settle();assert.ok(f.api.useTaskNotices().items.every(n=>n.scope==='A'));assert.equal(f.api.useTaskNotices().activeScope,'B');
 }finally{gate.resolve();await host?.settle();host?.unmount();f.close()}
});
