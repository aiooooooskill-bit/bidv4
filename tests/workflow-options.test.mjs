import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,nodes,response} from './helpers/component-fixture.mjs';
const ready={confirmed:true,stale:false};
const plan={input_versions:{analyse:'v1',outline:'o1',build:'b1',review:'r1'},steps:[{kind:'analyse',reusable:true},{kind:'outline',reusable:false},{kind:'build',reusable:false},{kind:'review',reusable:false}]};
const button=(view,text)=>find(view,n=>n.type==='button'&&n.props.children===text);
for(const checked of [false,true])test(`自动完成确认弹窗：审核${checked?'勾选':'默认关闭'}，复用有效解读并提交实际选择`,async()=>{
 const calls=[],f=await fixture(async(url,options)=>{if(url.endsWith('/workflow-plan'))return response(plan);calls.push({url,body:JSON.parse(options.body)});return response({})});
 const view=f.mount('WorkflowControls',{tid:'t1',flow:{bidder:ready,source_selection:{main:'招标.pdf'}},onChanged:async()=>{}});
 try{
  button(view,'自动完成').props.onClick();await view.settle();assert.equal(calls.length,0);
  const checkbox=()=>find(view,n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(checkbox().props.checked,false);
  assert.ok(nodes(view.render()).some(n=>n.props.children==='已有解读有效，将从后续未完成阶段继续。'));
  if(checked)checkbox().props.onChange({target:{checked:true}});
  button(view,'开始自动完成').props.onClick();await view.settle();assert.deepEqual(calls,[{url:'/api/bidv4/page-flow/t1/workflow',body:{input_versions:plan.input_versions,resume:false,include_review:checked}}]);
 }finally{view.unmount();f.close()}
});

test('取消后重新打开恢复默认不审核；恢复流程保留已保存审核选择并再次确认',async()=>{
 const calls=[],f=await fixture(async(url,options)=>url.endsWith('/workflow-plan')?response(plan):(calls.push(JSON.parse(options.body)),response({})));
 const props={tid:'t1',flow:{bidder:ready,source_selection:{main:'招标.pdf'}},onChanged:async()=>{}},view=f.mount('WorkflowControls',props);
 try{
  button(view,'自动完成').props.onClick();await view.settle();find(view,n=>n.type==='input').props.onChange({target:{checked:true}});button(view,'取消').props.onClick();
  button(view,'自动完成').props.onClick();await view.settle();assert.equal(find(view,n=>n.type==='input').props.checked,false);button(view,'取消').props.onClick();
  props.flow.workflow={state:'interrupted',id:'w1',options:{include_review:true}};
  button(view,'继续流程').props.onClick();await view.settle();assert.equal(calls.length,0);const check=find(view,n=>n.type==='input');assert.equal(check.props.checked,true);assert.equal(check.props.disabled,true);
  button(view,'确认并继续流程').props.onClick();await view.settle();assert.deepEqual(calls,[{input_versions:plan.input_versions,resume:true}]);
 }finally{view.unmount();f.close()}
});
for(const bidder of [undefined,{confirmed:false,stale:false},{confirmed:true,stale:true}])test('主体缺失或已过期时先显示选择表单，不发执行请求 '+JSON.stringify(bidder),async()=>{
 const calls=[],f=await fixture(async url=>{calls.push(url);return response(plan)}),props={tid:'t1',flow:{bidder,source_selection:{main:'招标.pdf'}},onChanged:async()=>{}},view=f.mount('WorkflowControls',props);
 try{button(view,'自动完成').props.onClick();await view.settle();assert.deepEqual(calls,[]);assert.ok(nodes(view.render()).some(n=>n.props.label==='确认制作信息'&&n.props.open));assert.ok(nodes(view.render()).some(n=>n.props.state===bidder&&n.props.onSaved));}finally{view.unmount();f.close()}
});

test('确认计划后依据变更仍提交确认时版本，409不启动；重新确认取得新版本',async()=>{
 let version='v1',started=0;const attempts=[];
 const f=await fixture(async(url,options={})=>{if(url.endsWith('/workflow-plan'))return response({...plan,input_versions:{analyse:version}});const body=JSON.parse(options.body);attempts.push(body);if(body.input_versions.analyse!==version)return response({detail:'自动完成依据已变化，请关闭后重新确认流程'},409);started++;return response({})});
 const view=f.mount('WorkflowControls',{tid:'t1',flow:{bidder:ready,source_selection:{main:'招标.pdf'}},onChanged:async()=>{}});
 try{
  button(view,'自动完成').props.onClick();await view.settle();version='v2';button(view,'开始自动完成').props.onClick();await view.settle();
  assert.equal(attempts[0].input_versions.analyse,'v1');assert.equal(started,0);assert.ok(nodes(view.render()).some(n=>n.props.label==='自动完成'&&n.props.open));assert.match(f.api.useTaskNotices().items.find(n=>n.id==='t1:workflow').detail,/依据已变化/);
  button(view,'取消').props.onClick();button(view,'自动完成').props.onClick();await view.settle();button(view,'开始自动完成').props.onClick();await view.settle();assert.equal(attempts[1].input_versions.analyse,'v2');assert.equal(started,1);
 }finally{view.unmount();f.close()}
});
