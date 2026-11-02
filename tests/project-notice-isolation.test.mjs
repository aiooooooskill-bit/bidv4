import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,find,nodes,response} from './helpers/component-fixture.mjs';

const flow=(tid='t1')=>({task:{id:tid,title:'同名项目'},analysis_current:false,execution:null,workflow:null,analysis_progress:[],files:[{path:'analysis/structure.md',content:'当前项目解读',hash:'h'}],review:{bids:[],status:'unreviewed',report:null},directory:null,source_selection:{main:'同一份.docx',supplements:[],excluded:[]},body_files:[],body_sections:[],volume_states:[],input_versions:{analyse:'v1'}});
const fetchFlow=current=>async url=>response(url.includes('/page-flow/')?current():url.includes('/artifacts?')?{artifacts:[]}:{files:[]});
const staleBanner=view=>nodes(view.render()).some(n=>n.props.className==='chapter-notice'&&String(n.props.children).includes('来源已变化'));

for(const state of ['running','needs_input'])test(`首次解读${state}时，部分成果不触发过期横条或过期提示`,async()=>{
 const current={...flow(),execution:{kind:'analyse',state,questions:[]}},f=await fixture(fetchFlow(()=>current)),view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{await view.settle();assert.equal(staleBanner(view),false);assert.ok(!f.api.useTaskNotices().items.some(n=>n.id==='t1:analysis-source'))}finally{view.unmount();f.close()}
});

test('过期解读进入本项目操作提示，轮询不弹出，解读完成后自动清除',async()=>{
 let current=flow();const f=await fixture(fetchFlow(()=>current)),view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{
  await view.settle();assert.equal(staleBanner(view),false);
  let notice=f.api.useTaskNotices().items.find(n=>n.id==='t1:analysis-source');assert.equal(notice?.scope,'t1');assert.equal(notice?.kind,'warning');assert.equal(f.api.useTaskNotices().toast,null);
  window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.equal(f.api.useTaskNotices().items.filter(n=>n.id==='t1:analysis-source').length,1);
  current={...current,analysis_current:true};window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.ok(!f.api.useTaskNotices().items.some(n=>n.id==='t1:analysis-source'));
 }finally{view.unmount();f.close()}
});

test('项目文件操作失败只进入操作提示，弹窗不重复显示错误',async()=>{
 const f=await fixture(async()=>response({detail:'项目文件已变化'},409)),props={tid:'t1',flow:flow(),sources:[{name:'同一份.docx',size:42}],disabled:false,onBusy(){},onChanged:async()=>{},onPreview(){}},view=f.mount('ProjectFiles',props);
 try{
  const button=label=>find(view,n=>n.type==='button'&&n.props.children===label);
  button('管理文件').props.onClick();button('移除').props.onClick();button('确认移除').props.onClick();await view.settle();
  assert.equal(nodes(view.render()).filter(n=>n.props.role==='alert').length,0);const notice=f.api.useTaskNotices().items.find(n=>n.id==='t1:source-files');assert.equal(notice?.scope,'t1');assert.equal(notice?.title,'项目文件更新未完成');assert.equal(button('确认移除').props.disabled,false);
 }finally{view.unmount();f.close()}
});

test('旧项目迟到的读取结果不能覆盖新项目或生成旧项目提示',async()=>{
 let release;const old=flow('old'),fresh={...flow('new'),files:[]};
 const f=await fixture(async url=>url.includes('/page-flow/old')?new Promise(resolve=>{release=()=>resolve(response(old))}):response(url.includes('/page-flow/new')?fresh:url.includes('/artifacts?')?{artifacts:[]}:{files:[]}));
 const props={tid:'old',mode:'analysis',onBack(){},onMode(){}},view=f.mount('ProjectWorkbench',props);
 try{view.render();props.tid='new';await view.settle();release();await view.settle();assert.ok(!f.api.useTaskNotices().items.some(n=>n.scope==='old'));assert.equal(find(view,n=>n.props.flow).props.flow.task.id,'new');assert.equal(staleBanner(view),false)}finally{view.unmount();f.close()}
});


test('操作提示可关闭，轮询不重新打开；新项目不显示旧项目提示',async()=>{
 const f=await fixture(async()=>response({}));let host;
 try{
  f.api.setNoticeScope('old');f.api.syncExecutionNotices('old',flow('old'));f.api.openNoticeCenter();host=f.mount('TaskNoticeHost');
  find(host,n=>n.props['aria-label']==='关闭操作提示').props.onClick();assert.equal(f.api.useTaskNotices().drawer,false);
  f.api.syncExecutionNotices('old',flow('old'));assert.equal(f.api.useTaskNotices().drawer,false);assert.equal(f.api.useTaskNotices().toast,null);
  f.api.setNoticeScope('new');f.api.syncExecutionNotices('new',{...flow('new'),files:[]});
  const button=f.mount('NoticeButton');assert.equal(nodes(button.render()).filter(n=>n.props.className==='ly-notice-count').length,0);button.unmount();
  f.api.openNoticeCenter();assert.ok(!nodes(host.render()).some(n=>n.props.className==='ly-notice-card'));
  const missing={...flow('new'),files:[],source_selection:{main:'',supplements:[],excluded:[]}};f.api.syncExecutionNotices('new',missing);
  assert.match(f.api.useTaskNotices().items.find(n=>n.scope==='new').message,/主文件/);
  f.api.syncExecutionNotices('new',{...missing,source_selection:flow('new').source_selection});assert.ok(!f.api.useTaskNotices().items.some(n=>n.scope==='new'));
 }finally{host?.unmount();f.close()}
});


test('上传回执丢失后归档，再选同一文件必须创建新项目并移除旧重试提示',async()=>{
 const tasks=new Map(),creates=[],uploads=[],opened=[];let fail=true;
 const f=await fixture(async(url,options={})=>{
  const u=new URL(url,'http://fixture'),method=options.method??'GET',tid=u.searchParams.get('task_id');
  if(u.pathname==='/api/bidv4/tasks'){
   if(method==='GET')return response({tasks:[...tasks.values()]});
   const body=JSON.parse(options.body),task={id:'t_'+body.request_id.replaceAll('-',''),title:body.title,stage:'new',created_at:'2026-11-02'};creates.push(task);tasks.set(task.id,task);return response({task},201);
  }
  if(u.pathname.startsWith('/api/bidv4/tasks/')&&method==='DELETE'){tasks.delete(u.pathname.split('/').at(-1));return response({ok:true})}
  if(u.pathname==='/api/bidv4/files'){
   if(!tasks.has(tid))return response({detail:'任务不存在'},404);
   if(method==='GET')return response({files:[]});uploads.push(tid);if(fail){fail=false;return response({detail:'上传回执丢失'},503)}return response({ok:true},201);
  }
  throw new Error('unexpected '+url);
 });
 const view=f.mount('TenderList',{mode:'analysis',onOpen:id=>opened.push(id)}),file=new File(['same content'],'同一份.docx',{lastModified:1});
 try{
  await view.settle();const pick=()=>find(view,n=>n.props.onPick).props.onPick(file);await pick();await view.settle();assert.equal(creates.length,1);assert.ok(f.api.useTaskNotices().items.some(n=>n.id.startsWith('upload:')));
  find(view,n=>n.type==='button'&&n.props.children==='归档').props.onClick();find(view,n=>n.props.onConfirm).props.onConfirm();await view.settle();assert.equal(tasks.size,0);
  await pick();await view.settle();assert.equal(creates.length,2);assert.notEqual(creates[0].id,creates[1].id);assert.deepEqual(opened,[creates[1].id]);assert.equal(uploads.length,2);assert.ok(!f.api.useTaskNotices().items.some(n=>n.id.startsWith('upload:')));
 }finally{view.unmount();f.close()}
});
