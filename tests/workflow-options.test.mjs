import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,nodes,response} from './helpers/component-fixture.mjs';

for(const checked of [false,true])test(`自动完成确认弹窗：审核${checked?'勾选':'默认关闭'}并提交实际选择`,async()=>{
 const calls=[],f=await fixture(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({})});
 const view=f.mount('WorkflowControls',{tid:'t1',flow:{source_selection:{main:'招标.pdf'}},onChanged:async()=>{}});
 try{
  find(view,n=>n.type==='button'&&n.props.children==='自动完成').props.onClick();
  assert.equal(calls.length,0,'Opening the dialog must not start execution');
  const checkbox=()=>find(view,n=>n.type==='input'&&n.props.type==='checkbox');
  assert.equal(checkbox().props.checked,false);
  assert.ok(nodes(view.render()).some(n=>n.props.children==='标书审核会消耗大量 Token，请按需选择。'));
  if(checked)checkbox().props.onChange({target:{checked:true}});
  find(view,n=>n.type==='button'&&n.props.children==='开始自动完成').props.onClick();await view.settle();
  assert.deepEqual(calls,[{url:'/api/bidv4/page-flow/t1/workflow',body:{resume:false,include_review:checked}}]);
 }finally{view.unmount();f.close()}
});

test('取消后重新打开恢复默认不审核；继续流程保留原流程选择',async()=>{
 const calls=[],f=await fixture(async(url,options)=>{calls.push(JSON.parse(options.body));return response({})});
 const props={tid:'t1',flow:{source_selection:{main:'招标.pdf'}},onChanged:async()=>{}},view=f.mount('WorkflowControls',props);
 try{
  find(view,n=>n.type==='button'&&n.props.children==='自动完成').props.onClick();
  find(view,n=>n.type==='input').props.onChange({target:{checked:true}});
  find(view,n=>n.type==='button'&&n.props.children==='取消').props.onClick();
  assert.equal(calls.length,0);
  find(view,n=>n.type==='button'&&n.props.children==='自动完成').props.onClick();
  assert.equal(find(view,n=>n.type==='input').props.checked,false);
  find(view,n=>n.type==='button'&&n.props.children==='取消').props.onClick();
  props.flow.workflow={state:'interrupted',id:'w1'};
  find(view,n=>n.type==='button'&&n.props.children==='继续流程').props.onClick();await view.settle();
  assert.deepEqual(calls,[{resume:true}]);
 }finally{view.unmount();f.close()}
});
