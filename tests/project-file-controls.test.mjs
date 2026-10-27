import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,nodes,response} from './helpers/component-fixture.mjs';
const button=(view,text)=>find(view,n=>n.type==='button'&&n.props.children===text);
const flow=()=>({review:{bids:[]},source_selection:{main:'原件.pdf',supplements:[{file:'清单.xlsx',role:'补充文件'}]},input_versions:{analyse:'v1'}});

test('项目标题原位编辑：保存、Esc取消与服务端冲突保留草稿',async()=>{
 const calls=[];let conflict=false;const f=await fixture(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response(conflict?{detail:'项目名称已变化'}:{},conflict?409:200)}),task={id:'t1',title:'原项目'},view=f.mount('ProjectTitle',{task,onOpen(){},onChanged:async()=>{}});
 try{
  find(view,n=>n.props['aria-label']==='编辑项目名称：原项目').props.onClick();let input=find(view,n=>n.type==='input');input.props.onChange({target:{value:'新项目'}});button(view,'保存').props.onClick();await view.settle();assert.deepEqual(calls[0],{url:'/api/bidv4/tasks/t1',body:{title:'新项目',previous_title:'原项目'}});
  find(view,n=>n.props['aria-label']==='编辑项目名称：原项目').props.onClick();input=find(view,n=>n.type==='input');input.props.onChange({target:{value:'取消草稿'}});find(view,n=>n.type==='input').props.onKeyDown({key:'Escape',nativeEvent:{},preventDefault(){}});assert.equal(calls.length,1);assert.ok(nodes(view.render()).some(n=>n.type==='button'&&n.props.children==='原项目'));
  conflict=true;find(view,n=>n.props['aria-label']==='编辑项目名称：原项目').props.onClick();find(view,n=>n.type==='input').props.onChange({target:{value:'冲突草稿'}});button(view,'保存').props.onClick();await view.settle();assert.equal(find(view,n=>n.type==='input').props.value,'冲突草稿');assert.ok(nodes(view.render()).some(n=>n.props.role==='alert'));
 }finally{view.unmount();f.close()}
});

test('名称编辑期间后台刷新不能更新旧名称条件；冲突保留草稿，重新编辑取得新条件',async()=>{
 const calls=[],f=await fixture(async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return body.previous_title==='另一窗口的新名称'?response({}):response({detail:'项目名称已变化'},409)});
 const props={task:{id:'t1',title:'开始编辑时的名称'},onOpen(){},onChanged:async()=>{}},view=f.mount('ProjectTitle',props);
 try{
  find(view,n=>n.props['aria-label']==='编辑项目名称：开始编辑时的名称').props.onClick();find(view,n=>n.type==='input').props.onChange({target:{value:'我的未保存草稿'}});
  props.task={...props.task,title:'另一窗口的新名称'};await view.settle();button(view,'保存').props.onClick();await view.settle();
  assert.equal(calls[0].previous_title,'开始编辑时的名称');assert.equal(find(view,n=>n.type==='input').props.value,'我的未保存草稿');assert.ok(nodes(view.render()).some(n=>n.props.role==='alert'));
  button(view,'取消').props.onClick();find(view,n=>n.props['aria-label']==='编辑项目名称：另一窗口的新名称').props.onClick();find(view,n=>n.type==='input').props.onChange({target:{value:'核对后的名称'}});button(view,'保存').props.onClick();await view.settle();
  assert.deepEqual(calls[1],{title:'核对后的名称',previous_title:'另一窗口的新名称'});assert.ok(!nodes(view.render()).some(n=>n.type==='input'));
 }finally{view.unmount();f.close()}
});

for(const [status,report,visible]of [['unreviewed',null,false],['stale',{},false],['reviewed',null,false],['reviewed',{},true]])test(`流程成果的审查报告入口：${status}，报告${!!report}`,async()=>{
 const flow={task:{id:'t1',title:'项目'},execution:null,workflow:{id:'w1',state:'completed',completed:['analyse','outline','build'],options:{include_review:false}},review:{bids:[],status,report},analysis_progress:[],files:[],directory:null,source_selection:{main:'a.pdf',supplements:[],excluded:[]},body_files:[],body_sections:[],volume_states:[],input_versions:{analyse:'v1'}};
 const f=await fixture(async url=>response(url.includes('/page-flow/')?flow:url.includes('/artifacts')?{artifacts:[]}:{files:[]})),view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{await view.settle();assert.equal(nodes(view.render()).some(n=>n.type==='button'&&n.props.children==='查看审查报告'),visible)}finally{view.unmount();f.close()}
});

test('文件管理包含首次主文件，删除使用当前版本；上传Excel默认走项目来源',async()=>{
 const calls=[],f=await fixture(async(url,options)=>{calls.push({url,options});return response({})}),props={tid:'t1',flow:flow(),sources:[{name:'原件.pdf',size:1024},{name:'清单.xlsx',size:2048}],disabled:false,onBusy(){},onChanged:async()=>{},onPreview(){}},view=f.mount('ProjectFiles',props);
 try{
  button(view,'管理文件').props.onClick();find(view,n=>n.type==='button'&&n.props.children==='移除').props.onClick();button(view,'确认移除').props.onClick();await view.settle();assert.match(calls[0].url,/files\/.*input_version=v1/);assert.equal(calls[0].options.method,'DELETE');
  const file=new File(['fixture'],'新清单.xlsx');find(view,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file],value:'selected'}});button(view,'上传并加入项目').props.onClick();await view.settle();assert.equal(calls[1].options.body.get('file').name,'新清单.xlsx');assert.ok(!calls[1].url.includes('purpose=bid'));
 }finally{view.unmount();f.close()}
});

test('文件管理拒绝过期来源保存并保留明确错误；运行中不允许删除',async()=>{
 const f=await fixture(async()=>response({detail:'项目文件已变化'},409)),props={tid:'t1',flow:flow(),sources:[{name:'原件.pdf',size:1024}],disabled:false,onBusy(){},onChanged:async()=>{},onPreview(){}},view=f.mount('ProjectFiles',props);
 try{button(view,'管理文件').props.onClick();button(view,'移除').props.onClick();button(view,'确认移除').props.onClick();await view.settle();assert.ok(nodes(view.render()).some(n=>n.props.role==='alert'&&n.props.children==='项目文件已变化'));props.disabled=true;assert.equal(button(view,'确认移除').props.disabled,true)}finally{view.unmount();f.close()}
});
