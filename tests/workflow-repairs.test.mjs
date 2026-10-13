import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise actual component handlers, API requests and notice actions in memory.
// Hook scheduling is a fixture; this does not claim browser layout coverage.
import {fixture,nodes,find,response,questionInput} from './helpers/component-fixture.mjs';

for(const loss of ['task','file'])test(`旧上传提示在其他文件成功及列表重挂后重试，${loss}回执丢失仍归原项目`,async()=>{
 const tasks=new Map(),sources=new Map(),creates=[],uploads=[],opened=[];let fail=true;
 const f=await fixture(async(url,options={})=>{
  const u=new URL(url,'http://fixture'),method=options.method??'GET';
  if(u.pathname==='/api/bidv4/tasks'){
   if(method==='GET')return response({tasks:[...tasks.values()]});
   const body=JSON.parse(options.body),task={id:'t_'+body.request_id.replaceAll('-',''),title:body.title,stage:'new',created_at:'2026-10-11'};
   creates.push(task);tasks.set(task.id,task);
   if(fail&&loss==='task'&&body.title==='A'){fail=false;return response({detail:'lost task receipt'},503)}
   return response({task},201);
  }
  const tid=u.searchParams.get('task_id');
  if(u.pathname==='/api/bidv4/files'){
   if(method==='GET')return response({files:[...(sources.get(tid)??new Map())].map(([name,data])=>({name,size:data.byteLength}))});
   const file=options.body.get('file');uploads.push({tid,name:file.name});if(!sources.has(tid))sources.set(tid,new Map());sources.get(tid).set(file.name,await file.arrayBuffer());
   if(fail&&loss==='file'&&file.name==='A.pdf'){fail=false;return response({detail:'lost file receipt'},503)}
   return response({ok:true},201);
  }
  if(u.pathname.endsWith('/raw'))return new Response(sources.get(tid).get(decodeURIComponent(u.pathname.split('/').at(-2))));
  throw new Error('unexpected request '+url);
 });
 let view=f.mount('TenderList',{mode:'analysis',onOpen:id=>opened.push(['old',id])});
 try{
  await view.settle();const pick=file=>find(view,n=>n.props.onPick).props.onPick(file);
  await pick(new File(['A content'],'A.pdf',{lastModified:1}));await view.settle();
  const notice=f.api.useTaskNotices().items.find(n=>n.title==='A.pdf上传未完成');assert.ok(notice?.action);
  await pick(new File(['B content'],'B.pdf',{lastModified:2}));await view.settle();
  view.unmount();view=f.mount('TenderList',{mode:'build',onOpen:id=>opened.push(['new',id])});await view.settle();
  await notice.action.run();await view.settle();
  assert.deepEqual(creates.map(t=>t.title),['A','B']);
  assert.equal(uploads.filter(u=>u.name==='A.pdf').length,1);assert.equal(uploads.find(u=>u.name==='A.pdf').tid,creates[0].id);
  assert.deepEqual(opened.at(-1),['new',creates[0].id]);assert.ok(!f.api.useTaskNotices().items.some(n=>n.id===notice.id));
 }finally{view.unmount();f.close()}
});

test('直接展示目录，父节点不选为正文；移除搜索、元信息、框标题和底部编号控件',async()=>{
 const f=await fixture(async()=>{throw new Error('no requests expected')});const selected=[];
 const content={response_documents:[{name:'技术标',directory:[{目录名称:'技术方案',level:1,children:[{目录名称:'实施安排',level:2,children:[],来源:['REQ-01']}]},{目录名称:'保障措施',level:1,children:[]}]}]};
 const original=structuredClone(content),view=f.mount('DirectoryPanel',{tid:'t1',value:{artifact_id:'a1',content_seq:1,content},onSaved:async()=>{},onSelect:(...args)=>selected.push(args)});
 try{
  assert.ok(!nodes(view.render()).some(n=>n.type==='input'||n.type==='select'||n.props.className==='directory-meta'||n.type==='article'));
  const title=text=>find(view,n=>n.props.className==='directory-title'&&n.props.children===text);
  title('技术方案').props.onClick();assert.deepEqual(selected,[]);
  title('保障措施').props.onClick();assert.deepEqual(selected,[['技术标','保障措施']]);
  title('实施安排').props.onClick();assert.deepEqual(selected.at(-1),['技术标','实施安排']);
  assert.deepEqual(content,original);
 }finally{view.unmount();f.close()}
});

test('资料库当前页签重复点击保持状态，栏目切换不重复加载主体',async()=>{
 const calls=[],f=await fixture(async url=>{calls.push(url);return response(url.endsWith('/overview')?{companies:[],representatives:[]}:{types:[],field_labels:{}})});
 const view=f.mount('Library');
 try{
  await view.settle();const active=()=>find(view,n=>n.type==='button'&&n.props.className==='active');
  active().props.onClick();await view.settle();assert.equal(calls.length,2);
  find(view,n=>n.type==='button'&&n.props.children==='Word版式').props.onClick();await view.settle();assert.equal(active().props.children,'Word版式');
  active().props.onClick();await view.settle();assert.equal(calls.length,2);
 }finally{view.unmount();f.close()}
});

test('原文选择与补充来源立即保存，重新进入保持身份；新上传不自动切换',async()=>{
 let flow={task:{id:'t1',title:'招标'},execution:null,analysis_progress:[],files:[],directory:null,source_selection:{main:'招标.docx',supplements:[],excluded:[]},body_files:[],body_sections:[],input_versions:{analyse:'v1'}};
 let files=[{name:'招标.docx',size:8,modified_at:'2026-10-12'}],fail=false;const saved=[],actions=[];
 const f=await fixture(async(url,options={})=>{
  const u=new URL(url,'http://fixture');
  if(u.pathname.endsWith('/sources')){if(fail){fail=false;return response({detail:'save unavailable'},503)}const body=JSON.parse(options.body);assert.equal(body.input_version,flow.input_versions.analyse);saved.push(body);flow={...flow,source_selection:{main:body.main_file,supplements:body.supplements.map(file=>({file,role:'补充文件'})),excluded:[]},input_versions:{analyse:'v'+(saved.length+1)}};return response(flow)}
  if(u.pathname.endsWith('/action')){actions.push(JSON.parse(options.body));return response({session_id:'fixture'})}
  if(u.pathname.includes('/page-flow/'))return response(flow);
  if(u.pathname.endsWith('/files')){if(options.method==='POST'){files.push({name:options.body.get('file').name,size:8,modified_at:'2026-10-12'});files.sort((a,b)=>a.name<b.name?-1:1);return response({ok:true})}return response({files})}
  if(u.pathname.endsWith('/artifacts'))return response({artifacts:[]});
  if(u.pathname.endsWith('/workbench'))return response({files:[]});
  throw new Error('unexpected '+url);
 });
 let view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 const select=()=>find(view,n=>n.props['aria-label']==='选择原文');
 try{
  await view.settle();assert.equal(select().props.value,'招标.docx');
  await find(view,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new File(['update'],'A更新.docx')],value:'x'}});await view.settle();
  assert.equal(select().props.value,'招标.docx');
  view.unmount();view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});await view.settle();assert.equal(select().props.value,'招标.docx');
  select().props.onChange({target:{value:'A更新.docx'}});await view.settle();assert.equal(select().props.value,'A更新.docx');assert.equal(flow.source_selection.main,'A更新.docx');
  find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await view.settle();assert.equal(flow.source_selection.supplements[0].file,'招标.docx');
  view.unmount();view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});await view.settle();assert.equal(select().props.value,'A更新.docx');assert.equal(find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.checked,true);
  fail=true;select().props.onChange({target:{value:'招标.docx'}});await view.settle();assert.equal(select().props.value,'A更新.docx');assert.equal(saved.length,2);
  find(view,n=>n.type==='button'&&n.props.children==='开始解读').props.onClick();await view.settle();assert.equal(actions[0].main_file,'A更新.docx');assert.deepEqual(actions[0].supplements,['招标.docx']);
 }finally{view.unmount();f.close()}
});

for(const timing of ['before','during'])test(`来源保存成功后，${timing}发出的旧详情读取不能覆盖新状态`,async()=>{
 let flow={task:{id:'t1',title:'招标'},execution:null,analysis_progress:[],files:[{path:'analysis/structure.md',content:'基本信息',hash:'h1'}],directory:null,source_selection:{main:'原始.docx',supplements:[],excluded:[]},body_files:[],body_sections:[],input_versions:{analyse:'v1'}};
 const files=[{name:'原始.docx',size:8,modified_at:'1'},{name:'更新.docx',size:8,modified_at:'1'}];
 const reading=Promise.withResolvers(),saving=Promise.withResolvers();let holdRead=false;const actions=[];
 const f=await fixture(async(url,options={})=>{
  if(url.endsWith('/sources')){const payload=JSON.parse(options.body);await saving.promise;flow={...flow,source_selection:{main:payload.main_file,supplements:[],excluded:[]},input_versions:{analyse:'v2'}};return response(flow)}
  if(url.endsWith('/action')){actions.push(JSON.parse(options.body));return response({session_id:'fixture'})}
  if(url.includes('/page-flow/'))return response(flow);
  if(url.includes('/files?'))return response({files});
  if(url.includes('/artifacts?'))return response({artifacts:[]});
  if(url.includes('/workbench?')){if(holdRead)await reading.promise;return response({files:[]})}
  throw new Error('unexpected '+url);
 });
 const view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{
  await view.settle();const load=find(view,n=>n.props.file?.path==='analysis/structure.md').props.onSaved;
  holdRead=true;let pendingRead;
  if(timing==='before'){pendingRead=load();await view.settle()}
  find(view,n=>n.props['aria-label']==='选择原文').props.onChange({target:{value:'更新.docx'}});await view.settle();
  if(timing==='during'){pendingRead=load();await view.settle()}
  saving.resolve();await view.settle();assert.equal(find(view,n=>n.props['aria-label']==='选择原文').props.value,'更新.docx');
  reading.resolve();await pendingRead;await view.settle();assert.equal(find(view,n=>n.props['aria-label']==='选择原文').props.value,'更新.docx');
  find(view,n=>n.type==='button'&&n.props.children==='开始解读').props.onClick();await view.settle();
  assert.equal(actions[0].main_file,'更新.docx');assert.equal(actions[0].input_version,'v2');
 }finally{reading.resolve();saving.resolve();view.unmount();f.close()}
});

test('详情刷新、重新进入及功能切换自动读取最新状态、目录、文档和原件版本，无常驻刷新按钮',async()=>{
 let revision=1,reads=0;
 const latest=()=>({task:{id:'t1',title:'版本'+revision},execution:null,analysis_progress:[],files:[{path:'analysis/structure.md',content:'文档'+revision,hash:'h'+revision}],directory:{artifact_id:'dir',content_seq:revision,content:{response_documents:[{name:'技术标',directory:[{目录名称:'章节'+revision,level:1,children:[]}]}]}},source_selection:{main:'招标.docx',supplements:[],excluded:[]},body_files:[],body_sections:[],input_versions:{analyse:'v'+revision,revise:'body'+revision}});
 const f=await fixture(async url=>{
  if(url.includes('/page-flow/')){reads++;return response(latest())}
  if(url.includes('/files?'))return response({files:[{name:'招标.docx',size:8,modified_at:String(revision)}]});
  if(url.includes('/artifacts?'))return response({artifacts:[]});
  if(url.includes('/workbench?'))return response({files:[]});
  throw new Error('unexpected '+url);
 });
 const props={tid:'t1',mode:'analysis',onBack(){},onMode(){}};let view=f.mount('ProjectWorkbench',props);
 const noRefresh=()=>assert.ok(!nodes(view.render()).some(n=>n.type==='button'&&n.props.children==='重新读取'));
 try{
  noRefresh();await view.settle();noRefresh();assert.equal(find(view,n=>n.props.file).props.file.content,'文档1');
  // Browser refresh and returning from the list both create a new mounted detail.
  for(const operation of ['refresh','reenter']){revision++;view.unmount();view=f.mount('ProjectWorkbench',props);await view.settle();noRefresh();assert.equal(find(view,n=>n.props.file).props.file.content,'文档'+revision,operation);assert.ok(find(view,n=>n.props.name==='招标.docx').props.url.includes('v='+revision+'%3A8'))}
  revision++;props.mode='build';await view.settle();noRefresh();assert.equal(find(view,n=>n.props.flow?.directory?.artifact_id==='dir').props.flow.directory.content_seq,revision);
  revision++;props.mode='review';await view.settle();noRefresh();assert.equal(find(view,n=>n.props.flow?.directory?.artifact_id==='dir').props.flow.directory.content_seq,revision);
  revision++;props.mode='analysis';await view.settle();noRefresh();assert.equal(find(view,n=>n.props.file).props.file.content,'文档'+revision);assert.equal(reads,6);
 }finally{view.unmount();f.close()}
});

test('详情首次读取失败通过集中提示恢复，无页面刷新按钮',async()=>{
 let fail=true;
 const flow={task:{id:'t1',title:'招标'},execution:null,analysis_progress:[],files:[],directory:null,source_selection:{main:'',supplements:[],excluded:[]},body_files:[],body_sections:[],input_versions:{analyse:'v1'}};
 const f=await fixture(async url=>{
  if(url.includes('/page-flow/'))return fail?response({detail:'读取不可用'},503):response(flow);
  if(url.includes('/files?')||url.includes('/workbench?'))return response({files:[]});
  if(url.includes('/artifacts?'))return response({artifacts:[]});
  throw new Error('unexpected '+url);
 });
 const view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 try{
  await view.settle();assert.ok(!nodes(view.render()).some(n=>n.type==='button'&&n.props.children==='重新读取'));
  const notice=f.api.useTaskNotices().items.find(n=>n.id==='t1:project-load');assert.ok(notice?.action);
  fail=false;await notice.action.run();await view.settle();assert.ok(!f.api.useTaskNotices().items.some(n=>n.id==='t1:project-load'));assert.ok(nodes(view.render()).some(n=>n.props['aria-label']==='选择原文'));
 }finally{view.unmount();f.close()}
});


test('制作整本不受当前章节选择影响；章节与整册预览按真实文件版本切换',async()=>{
 const actions=[],flow={task:{id:'t1',title:'制作'},execution:null,files:[],directory:{artifact_id:'dir',content_seq:1,content:{numbering:'decimal',page_target:120,response_documents:[]}},body_files:['body/已写.docx'],body_sections:[{volume:'技术',title:'已写',path:'body/已写.docx',status:'ready'},{volume:'技术',title:'未写',path:'body/未写.docx',status:'missing'}],build_preparation:{guide:'ready',promises:'ready'},orphan_body_files:[],volume_states:[{name:'技术标',artifact_id:'volume',path:'body/整本-技术标.docx',status:'ready'}],input_versions:{revise:'v5',build:'v6'}};
 const f=await fixture(async()=>{throw new Error('no network expected')});
 const view=f.mount('BuildWorkspace',{tid:'t1',mode:'build',flow,input:questionInput(),artifacts:[{kind:'tender.volume',artifact_id:'volume',display_name:'技术标',content_seq:4}],disabled:false,busy:false,onChanged:async()=>{},execute:async(...args)=>{actions.push(args);return true},exportVolume:async()=>{},renderDocument:()=>null,checksPanel:null});
 try{
  find(view,n=>n.props.onSelect).props.onSelect('技术','已写');await view.settle();
  assert.ok(find(view,n=>n.props.name==='body/已写.docx').props.url.includes('v=v5'));
  find(view,n=>n.type==='button'&&n.props.children==='继续制作标书').props.onClick();await view.settle();assert.deepEqual(actions[0],['build',[]]);
  find(view,n=>n.type==='button'&&n.props.children==='更新当前章').props.onClick();await view.settle();assert.deepEqual(actions[1].slice(0,2),['body',[{volume:'技术',title:'已写'}]]);
  find(view,n=>n.type==='button'&&n.props.children==='预览整册').props.onClick();await view.settle();assert.equal(find(view,n=>n.props.name==='技术标.docx').props.url,'/api/bidv4/artifacts/volume/file?v=4');
  find(view,n=>n.type==='button'&&n.props.children==='返回章节预览').props.onClick();await view.settle();assert.equal(find(view,n=>n.props.name==='body/已写.docx').props.name,'body/已写.docx');
 }finally{view.unmount();f.close()}
});

test('停止后单章缺失准备可生成；运行阶段跟随实际范围，过期准备显示原因与入口',async()=>{
 const actions=[],flow={task:{id:'t1'},files:[],execution:{state:'stopped',kind:'build'},directory:{artifact_id:'dir',content_seq:1,content:{response_documents:[]}},body_files:[],body_sections:[{volume:'技术',title:'投标函',path:'body/投标函.docx',status:'missing'}],build_preparation:{guide:'missing',promises:'missing'},build_preparation_changes:{guide:[],promises:[]},volume_states:[],input_versions:{revise:'v1'}};
 const f=await fixture(async()=>{throw new Error('no requests')});
 const props={tid:'t1',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async(...args)=>{actions.push(args);return true},exportVolume:async()=>{},renderDocument:()=>null,checksPanel:null};
 const view=f.mount('BuildWorkspace',props);
 try{
  find(view,n=>n.props.onSelect).props.onSelect('技术','投标函');await view.settle();
  const progress=()=>nodes(find(view,n=>n.props.className==='build-status'));
  const generate=()=>find(view,n=>n.type==='button'&&n.props.children==='生成当前章');
  assert.equal(generate().props.disabled,false);await generate().props.onClick();assert.deepEqual(actions[0].slice(0,2),['body',[{volume:'技术',title:'投标函'}]]);
  props.disabled=true;flow.execution={state:'running',kind:'body',sections:[{volume:'技术',title:'投标函'}],questions:[]};assert.equal(generate().props.disabled,true);
  assert.ok(progress().some(n=>n.props.children==='准备写作指引'));
  flow.build_preparation.guide='ready';assert.ok(progress().some(n=>n.props.children==='整理关键事实与承诺'));
  flow.execution.state='needs_input';flow.execution.questions=[{questions:[{header:'维护期',question:'维护期是多少？'}]}];assert.ok(progress().some(n=>n.props.children==='等待维护期答复'));
  flow.execution.state='running';flow.build_preparation.promises='ready';assert.ok(progress().some(n=>n.props.children==='正在生成投标函'));
  props.disabled=false;flow.execution.state='stopped';flow.build_preparation.guide='stale';flow.build_preparation_changes.guide=['目录内容或目标篇幅已变化'];assert.equal(generate().props.disabled,true);
  assert.ok(nodes(view.render()).some(n=>n.props.children==='写作准备需要核对'));find(view,n=>n.type==='button'&&n.props.children==='查看写作指引').props.onClick();await view.settle();assert.ok(find(view,n=>n.type==='button'&&n.props.children==='生成写作指引'));
 }finally{view.unmount();f.close()}
});

test('目录弹窗只提交篇幅与编号；非法页数被禁用，不限篇幅提交null且失败保留弹窗',async()=>{
 const submitted=[],closed=[],f=await fixture(async()=>{throw new Error('no network expected')});
 let succeeds=false;
 const view=f.mount('OutlineOptionsDialog',{busy:false,onClose:()=>closed.push(true),onSubmit:async options=>{submitted.push(options);return succeeds}});
 try{
  const pages=()=>find(view,n=>n.props['aria-label']==='目标篇幅页数'),submit=()=>find(view,n=>n.type==='button'&&n.props.children==='确认并生成');
  pages().props.onChange({target:{value:'0'}});view.render();assert.equal(submit().props.disabled,true);
  pages().props.onChange({target:{value:'1001'}});view.render();assert.equal(submit().props.disabled,true);
  find(view,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});view.render();assert.equal(pages().props.disabled,true);assert.equal(submit().props.disabled,false);
  await submit().props.onClick();assert.deepEqual(submitted[0],{page_target:null,numbering:'decimal'});assert.deepEqual(closed,[]);
  succeeds=true;find(view,n=>n.type==='input'&&n.props.name==='outline-numbering'&&n.props.checked).props.onChange();await submit().props.onClick();assert.deepEqual(closed,[true]);
 }finally{view.unmount();f.close()}
});


test('重复点击当前制作页签保留真实未保存拦截；整册未就绪仍可继续制作',async()=>{
 const f=await fixture(async()=>{throw new Error('no requests')});
 const guard=f.mount('NavigationGuard',{children:null});
 const flow={bidder:{confirmed:true,stale:false},task:{id:'t1'},files:[],execution:{state:'completed',kind:'build'},directory:{artifact_id:'dir',content_seq:1,content:{response_documents:[]}},body_files:['body/方案.docx'],body_sections:[{volume:'技术',title:'方案',path:'body/方案.docx',status:'ready'}],build_preparation:{guide:'ready',promises:'ready'},input_versions:{revise:'v1'},volume_states:[{name:'技术',artifact_id:null,status:'missing'}]};
 const view=f.mount('BuildWorkspace',{tid:'t1',mode:'build',flow,input:questionInput(),artifacts:[{kind:'tender.volume',artifact_id:'old',display_name:'旧技术标',content_seq:1}],disabled:false,busy:false,onChanged:async()=>{},execute:async()=>true,exportVolume:async()=>{},renderDocument:()=>null,checksPanel:null});
 try{
  let context=guard.render().props.value;context.mark('t1:directory',true);guard.render();view.render();
  assert.equal(find(view,n=>n.props.children==='继续制作标书').props.disabled,true);
  find(view,n=>n.props.className==='bp-tab'&&n.props['data-active']).props.onClick();guard.render();view.render();
  assert.equal(guard.render().props.value.hasDirty,true);
  assert.ok(!nodes(guard.render()).some(n=>n.props.label==='未保存修改'&&n.props.open));
  context=guard.render().props.value;context.mark('t1:directory',false);guard.render();view.render();
  assert.equal(find(view,n=>n.props.children==='继续制作标书').props.disabled,false);
  assert.ok(!nodes(view.render()).some(n=>n.props.children==='下载标书'));
  assert.ok(nodes(view.render()).some(n=>n.props.children==='下载历史整册'));
  flow.volume_states=[{name:'技术',artifact_id:'old',status:'ready'}];view.render();
  assert.equal(find(view,n=>n.type==='button'&&n.props.children==='标书已制作').props.disabled,true);
  assert.ok(nodes(view.render()).some(n=>n.props.children==='下载标书'));
 }finally{view.unmount();guard.unmount();f.close()}
});

test('目录行内改名、更多排序、添加和跨父级移动保存完整目录，保留编制说明',async()=>{
 const sent=[],f=await fixture(async(_url,options)=>{sent.push(JSON.parse(options.body));return response({ok:true})});
 const content={numbering:'gov',page_target:null,response_documents:[{name:'投标文件',scope:'编制说明保留',directory:[{目录名称:'方案',level:1,children:[{目录名称:'实施',level:2,children:[],来源:['REQ-01']}]},{目录名称:'保障',level:1,children:[]}]}]};
 const view=f.mount('DirectoryPanel',{tid:'t1',value:{artifact_id:'dir',content_seq:2,content},onSaved:async()=>{},onSelect(){}});
 const click=text=>find(view,n=>n.type==='button'&&n.props.children===text).props.onClick();
 const icon=label=>find(view,n=>n.props['aria-label']===label).props.onClick({currentTarget:{getBoundingClientRect:()=>({bottom:650,right:500})}});
 try{
  click('编辑目录');view.render();icon('编辑标题：实施');view.render();
  find(view,n=>n.props['aria-label']==='章节标题').props.onChange({target:{value:'实施安排'}});view.render();click('确认');view.render();
  icon('更多操作：保障');view.render();click('置顶');view.render();
  icon('更多操作：实施安排');view.render();click('移动到其他父级');view.render();
  const select=find(view,n=>n.props['aria-label']==='目标父级');const target=nodes(select).find(n=>n.type==='option'&&n.props.children.endsWith('保障'));select.props.onChange({target:{value:target.props.value}});view.render();click('确认');view.render();
  click('+ 添加一级目录');view.render();find(view,n=>n.props['aria-label']==='章节标题').props.onChange({target:{value:'附件'}});view.render();click('确认');view.render();
  await click('保存目录');await view.settle();
  const saved=sent[0].content;assert.equal(sent[0].base_content_seq,2);assert.equal(saved.numbering,'gov');assert.equal(saved.page_target,null);assert.equal(saved.response_documents[0].scope,'编制说明保留');
  const roots=saved.response_documents[0].directory;assert.deepEqual(roots.map(n=>n.目录名称),['保障','方案','附件']);assert.equal(roots[0].children[0].目录名称,'实施安排');assert.equal(roots[0].children[0].level,2);assert.deepEqual(roots[0].children[0].来源,['REQ-01']);assert.ok(!JSON.stringify(saved).includes('_id'));
 }finally{view.unmount();f.close()}
});

test('制作执行和停止同处紧凑状态栏；具体选项提交仍校验当前会话',async()=>{
 const calls=[],execution={session_id:'s1',state:'needs_input',kind:'build',questions:[{callId:'q1',questions:[{id:'term',question:'维护期限',options:[{label:'三年'}]}]}]};
 const f=await fixture(async(url,options)=>{calls.push([url,options]);return response(url.endsWith('/t1')?{execution}:{ok:true})});
 const props={tid:'t1',execution,input:questionInput(),onChanged:async()=>{},layout:'build',progress:'正文 0/1 章'};
 const view=f.mount('ExecutionControls',props);
 try{
  assert.equal(find(view,n=>n.props.className==='build-status').props.className,'build-status');
  find(view,n=>n.type==='input'&&n.props.type==='radio').props.onChange({target:{checked:true}});view.render();
  find(view,n=>n.type==='form').props.onSubmit({preventDefault(){}});await view.settle();assert.equal(calls[1][0],'/api/bidv4/page-flow/t1/answer');assert.equal(JSON.parse(calls[1][1].body).session_id,'s1');
  find(view,n=>n.type==='button'&&n.props.children==='停止').props.onClick();await view.settle();assert.equal(calls.at(-1)[0],'/api/bidv4/page-flow/t1/stop');
  props.execution={...execution,state:'completed',questions:[]};view.render();assert.ok(!nodes(view.render()).some(n=>n.props.className==='ly-task-strip'));assert.ok(nodes(find(view,n=>n.props.className==='build-status')).some(n=>n.props.children==='本轮已结束'));assert.ok(!nodes(view.render()).some(n=>n.type==='button'&&n.props.children==='停止'));
 }finally{view.unmount();f.close()}
});

test('同项目问答草稿跨解读制作审查保留，问题变化才清空',async()=>{
 let execution={session_id:'s1',state:'needs_input',kind:'build',questions:[{callId:'q1',questions:[{id:'term',question:'维护期限',options:[{label:'三年'},{label:'五年'}]}]}]};
 const flow=()=>({task:{id:'t1',title:'问答验证'},execution,analysis_progress:[],files:[],directory:null,source_selection:{main:'',supplements:[],excluded:[]},body_files:[],body_sections:[],volume_states:[],build_preparation:{guide:'missing',promises:'missing'},input_versions:{analyse:'v1'}});
 const f=await fixture(async url=>url.includes('/page-flow/')?response(flow()):url.includes('/artifacts?')?response({artifacts:[]}):response({files:[]}));
 const props={tid:'t1',mode:'analysis',onBack(){},onMode(){}};
 const project=f.mount('ProjectWorkbench',props);let controls;
 const inputProps=()=>{
  const entry=find(project,n=>n.props.tid==='t1'&&(n.props.execution||n.props.flow));
  return entry.props.flow?{tid:'t1',execution:entry.props.flow.execution,input:entry.props.input,onChanged:entry.props.onChanged}:entry.props;
 };
 const sync=()=>{controls?.unmount();controls=f.mount('ExecutionControls',inputProps());controls.render()};
 try{
  await project.settle();assert.ok(inputProps().input,'问答输入应由项目详情持有');sync();
  find(controls,n=>n.type==='input'&&n.props.type==='radio').props.onChange({target:{checked:true}});
  await project.settle();sync();
  find(controls,n=>n.type==='textarea').props.onChange({target:{value:'按招标要求执行'}});
  for(const mode of ['build','review','analysis']){
   props.mode=mode;await project.settle();sync();
   assert.equal(find(controls,n=>n.type==='input'&&n.props.type==='radio').props.checked,true,mode);
   assert.equal(find(controls,n=>n.type==='textarea').props.value,'按招标要求执行',mode);
  }
  execution={...execution,questions:[{callId:'q2',questions:[{id:'term',question:'新的维护期限',options:[{label:'三年'}]}]}]};
  await inputProps().onChanged();await project.settle();sync();
  assert.equal(find(controls,n=>n.type==='input').props.checked,false);
  assert.equal(find(controls,n=>n.type==='textarea').props.value,'');
  find(controls,n=>n.type==='input').props.onChange({target:{checked:true}});
  await project.settle();sync();
  execution={...execution,session_id:'s2'};
  await inputProps().onChanged();await project.settle();sync();
  assert.equal(find(controls,n=>n.type==='input').props.checked,false,'新会话不能继承上一轮答案');
 }finally{controls?.unmount();project.unmount();f.close()}
});

test('目录册名首尾空白不影响章节选择和状态匹配',async()=>{
 const f=await fixture(async()=>{throw new Error('no requests')});const selected=[];
 const view=f.mount('DirectoryPanel',{tid:'t1',value:{artifact_id:'dir',content_seq:1,content:{response_documents:[{name:' 技术标 ',directory:[{目录名称:'实施方案',level:1,children:[]}]}]}},statuses:[{volume:'技术标',title:'实施方案',status:'ready'}],onSaved:async()=>{},onSelect:(...args)=>selected.push(args)});
 try{
  find(view,n=>n.props.className==='directory-title').props.onClick();
  assert.deepEqual(selected,[['技术标','实施方案']]);
  assert.equal(find(view,n=>n.props.className==='directory-file-state').props.children,'已生成');
 }finally{view.unmount();f.close()}
});
