import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response,questionInput} from './helpers/component-fixture.mjs';

const execution=()=>({session_id:'s1',state:'needs_input',kind:'build',questions:[{callId:'q1',questions:[
 {id:'term',header:'期限',question:'服务期限是多少？',options:[{label:'三年'},{label:'五年'}]},
 {id:'scope',header:'范围',question:'服务范围包含哪些？',multiSelect:true,options:[{label:'总部'},{label:'分支机构'}]},
 {id:'note',header:'补充',question:'其他已确定的信息？'},
]}]});
const flowFor=(current=execution(),tid='t1')=>({task:{id:tid,title:'核对面板验证'},execution:current,analysis_progress:[],files:[],directory:{artifact_id:'dir',content_seq:1,content:{response_documents:[]}},source_selection:{main:'',supplements:[],excluded:[]},body_files:[],body_sections:[{volume:'技术',title:'方案',path:'body/方案.docx',status:'missing'}],volume_states:[],build_preparation:{guide:'ready',promises:'ready'},build_preparation_changes:{guide:[],promises:[]},input_versions:{analyse:'v1',revise:'v1'}});
const buildProps=(flow,input=questionInput())=>({tid:flow.task.id,mode:'build',flow,input,artifacts:[],disabled:true,busy:false,onChanged:async()=>{},execute:async()=>true,exportVolume:async()=>{},renderDocument:()=>null,checksPanel:null});
const button=(view,label)=>find(view,n=>n.type==='button'&&n.props.children===label);
const hasPanel=view=>nodes(view.render()).some(n=>n.type==='aside'&&n.props['aria-label']==='制作核对面板');

test('侧边问题由当前批次驱动，收起、轮询和切换章节页签保留答复草稿',async()=>{
 const f=await fixture(async()=>{throw new Error('no network expected')});
 const props=buildProps(flowFor()),view=f.mount('BuildWorkspace',props);
 try{
  assert.ok(hasPanel(view));
  const aside=find(view,n=>n.type==='aside');
  assert.equal(nodes(aside).filter(n=>n.type==='fieldset').length,3);
  assert.equal(nodes(view.render()).filter(n=>n.type==='form').length,1,'不能复制第二份表单');
  const radio=find(view,n=>n.type==='input'&&n.props.type==='radio');radio.props.onChange({target:{checked:true}});
  find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  const note=nodes(view.render()).filter(n=>n.type==='textarea').at(-1);note.props.onChange({target:{value:'已确认的补充信息'}});
  button(view,'收起核对面板').props.onClick();assert.equal(hasPanel(view),false);
  props.flow=structuredClone(props.flow);view.render();assert.equal(hasPanel(view),false,'同身份轮询不能重复展开');
  find(view,n=>n.props.onSelect).props.onSelect('技术','方案');
  button(view,'写作指引').props.onClick();assert.equal(hasPanel(view),false);
  button(view,'打开核对面板').props.onClick();assert.ok(hasPanel(view));
  assert.equal(find(view,n=>n.type==='input'&&n.props.type==='radio').props.checked,true);
  assert.equal(find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.checked,true);
  assert.equal(nodes(view.render()).filter(n=>n.type==='textarea').at(-1).props.value,'已确认的补充信息');
  button(view,'收起核对面板').props.onClick();
  props.flow.execution={...props.flow.execution,questions:[{callId:'q2',questions:[{id:'new',question:'新的信息？'}]}]};
  assert.ok(hasPanel(view),'新问题身份应再次展开');
  assert.equal(nodes(find(view,n=>n.type==='aside')).filter(n=>n.type==='fieldset').length,1);
 }finally{view.unmount();f.close()}
});

test('侧边面板沿用项目输入生命周期，新问题、会话及项目不继承旧答案',async()=>{
 let current=execution();
 const f=await fixture(async url=>url.includes('/page-flow/')?response(flowFor(current,url.endsWith('/t2')?'t2':'t1')):url.includes('/artifacts?')?response({artifacts:[]}):response({files:[]}));
 const props={tid:'t1',mode:'build',onBack(){},onMode(){}},project=f.mount('ProjectWorkbench',props);
 let panel;
 try{
  await project.settle();
  const entry=()=>find(project,n=>n.props.flow&&n.props.input);
  const panelProps={...entry().props};panel=f.mount('BuildWorkspace',panelProps);
  const sync=async()=>{await project.settle();Object.assign(panelProps,entry().props);panel.render()};
  find(panel,n=>n.type==='input'&&n.props.type==='radio').props.onChange({target:{checked:true}});await sync();
  find(panel,n=>n.type==='textarea').props.onChange({target:{value:'上一轮说明'}});await sync();
  button(panel,'收起核对面板').props.onClick();await entry().props.onChanged();await sync();assert.equal(hasPanel(panel),false);
  button(panel,'打开核对面板').props.onClick();assert.equal(find(panel,n=>n.type==='textarea').props.value,'上一轮说明');
  current={...current,questions:[{callId:'q2',questions:[{id:'term',question:'新问题',options:[{label:'三年'}]}]}]};
  await entry().props.onChanged();await sync();
  assert.equal(find(panel,n=>n.type==='input').props.checked,false);assert.equal(find(panel,n=>n.type==='textarea').props.value,'');
  find(panel,n=>n.type==='textarea').props.onChange({target:{value:'第二轮说明'}});await sync();
  current={...current,session_id:'s2'};await entry().props.onChanged();await sync();assert.equal(find(panel,n=>n.type==='textarea').props.value,'');
  find(panel,n=>n.type==='textarea').props.onChange({target:{value:'项目一的说明'}});await sync();
  props.tid='t2';await sync();assert.equal(find(panel,n=>n.type==='textarea').props.value,'');assert.equal(panelProps.tid,'t2');
 }finally{panel?.unmount();project.unmount();f.close()}
});

test('侧边提交与顶部停止共用锁，收起再展开不复制提交，旧问题不能提交',async()=>{
 const calls=[],flow=flowFor(),input=questionInput();let release,changed=0;
 for(const q of flow.execution.questions[0].questions)input.notes['q1:'+q.id]='已确认';
 const f=await fixture(async(url,options)=>{
  calls.push([url,options]);
  if(url.endsWith('/t1'))return new Promise(resolve=>{release=()=>resolve(response({execution:flow.execution}))});
  return response({ok:true});
 });
 const props={...buildProps(flow,input),onChanged:async()=>{changed++}},view=f.mount('BuildWorkspace',props);
 try{
  find(view,n=>n.type==='form').props.onSubmit({preventDefault(){}});view.render();
  button(view,'收起核对面板').props.onClick();button(view,'停止').props.onClick();
  button(view,'打开核对面板').props.onClick();find(view,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1,'请求等待期间停止和第二次提交应受同一把锁保护');
  release();await view.settle();
  assert.equal(calls.filter(([url])=>url.endsWith('/answer')).length,1);assert.equal(changed,1);
  const body=JSON.parse(calls.find(([url])=>url.endsWith('/answer'))[1].body);
  assert.equal(body.batches[0].answers.length,3);assert.equal(body.batches[0].answers[2].custom,'已确认');
  find(view,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  flow.execution={...flow.execution,questions:[{callId:'q2',questions:[{id:'different',question:'变更后的问题'}]}]};
  release();await view.settle();
  assert.equal(calls.filter(([url])=>url.endsWith('/answer')).length,1,'问题身份变化不能沿旧问题提交');
  assert.ok(f.api.useTaskNotices().items.some(item=>item.title==='选项提交未完成'));
 }finally{view.unmount();f.close()}
});

test('过期准备只导航到原编辑页签，Escape 尊重已由弹窗处理的事件',async()=>{
 const calls=[],flow=flowFor({session_id:'s1',state:'stopped',kind:'build',questions:[]});
 flow.build_preparation={guide:'stale',promises:'stale'};flow.build_preparation_changes={guide:['目录已调整'],promises:['主体已调整']};
 const original=structuredClone(flow),f=await fixture(async()=>{throw new Error('no network expected')});
 const view=f.mount('BuildWorkspace',{...buildProps(flow),disabled:false,execute:async(...args)=>{calls.push(args);return true}});
 try{
  assert.ok(hasPanel(view));assert.ok(nodes(view.render()).some(n=>n.props.children==='目录已调整'));
  button(view,'查看写作指引').props.onClick();assert.ok(button(view,'生成写作指引'));
  button(view,'查看关键事实与承诺').props.onClick();assert.ok(button(view,'生成承诺清单'));
  assert.deepEqual(flow,original);assert.deepEqual(calls,[],'页面导航不能伪造准备已核对');
  const consumed=new Event('keydown',{cancelable:true});Object.defineProperty(consumed,'key',{value:'Escape'});consumed.preventDefault();window.dispatchEvent(consumed);
  assert.ok(hasPanel(view),'已由 Modal 消费的 Escape 不能顺带关闭面板');
  const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});window.dispatchEvent(escape);assert.equal(hasPanel(view),false);
 }finally{view.unmount();f.close()}
});
