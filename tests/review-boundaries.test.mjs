import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {fixture,find,nodes,response,questionInput} from './helpers/component-fixture.mjs';
import {checkInstallation} from '../server/installation.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);

test('新目录默认隐藏写作准备，首次生成自动补齐，已有正文缺准备时才显示入口',async()=>{
 const section={volume:'技术册',title:'实施说明',path:'body/实施说明.docx',status:'missing'};
 const flow={task:{id:'t'},execution:null,files:[],directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},body_sections:[section],body_files:[],build_preparation:{guide:'missing',promises:'missing'},volume_states:[],input_versions:{revise:'r'}};
 const calls=[],f=await fixture(async()=>{throw Error('不应联网')});
 const view=f.mount('BuildWorkspace',{tid:'t',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,syncing:false,onChanged:async()=>{},execute:async(...args)=>{calls.push(args);return true},exportVolume:async()=>{},renderDocument:()=>null});
 const preparation=()=>nodes(view.render()).filter(n=>n.props['aria-label']==='写作准备');
 try{
  assert.equal(preparation().length,0);
  find(view,n=>n.props.statuses).props.onSelect(section.volume,section.title);
  assert.equal(preparation().length,0,'尚无正文时不提示修改正文的前置要求');
  await find(view,n=>n.type==='button'&&text(n)==='生成当前章').props.onClick();
  assert.deepEqual(calls,[['body',[{volume:section.volume,title:section.title}],{instruction:''}]],'沿用自动准备的原生成链路');
  flow.body_files=[section.path];section.status='unverified';view.render();
  assert.equal(preparation().length,1);
  assert.match(text(preparation()[0]),/补齐写作指引/);
  assert.equal(find(view,n=>n.type==='button'&&text(n)==='修改当前章').props.disabled,true);
  flow.build_preparation={guide:'ready',promises:'ready'};view.render();
  assert.equal(preparation().length,0);
  assert.equal(find(view,n=>n.type==='button'&&text(n)==='修改当前章').props.disabled,false);
 }finally{view.unmount();f.close()}
});

test('安装与启用不要求外部排版软件',async()=>{
 const result=await checkInstallation(root);
 assert.equal(result.ok,true,JSON.stringify(result.errors));
 assert.ok(!result.checks.some(c=>/LibreOffice|排版引擎/.test(c.name)));
 assert.equal(result.layout,undefined);
});

for(const [volume,parent,child,status] of [['技术资信文件','项目管理方案','服务流程','stale'],['投标文件','实施组织方案','验收安排','missing']])
test('新边界：'+volume+'持有正文的父节点可选中，纯结构父节点保持不可选',async()=>{
 const chosen=[];
 const content={response_documents:[{name:volume,directory:[{目录名称:parent,level:1,children:[{目录名称:child,level:2,children:[]}]},
  {目录名称:'纯结构容器',level:1,children:[{目录名称:'其他子节',level:2,children:[]}]}]}]};
 const props={tid:'t',value:{artifact_id:'directory',content_seq:2,content},onSaved:async()=>{},onSelect:(...s)=>chosen.push(s),
  statuses:[{volume,title:parent,path:'body/'+parent+'.docx',status},{volume,title:child,path:'body/'+child+'.docx',status:'ready'}]};
 const f=await fixture(async()=>{throw Error('不应联网')}),view=f.mount('DirectoryPanel',props);
 try{
  find(view,n=>n.type==='button'&&n.props.children===parent).props.onClick();
  assert.deepEqual(chosen,[[volume,parent]]);
  assert.ok(nodes(view.render()).some(n=>n.props.className==='directory-file-state'&&n.props['data-state']===status));
  find(view,n=>n.type==='button'&&n.props.children==='纯结构容器').props.onClick();assert.equal(chosen.length,1);
  find(view,n=>n.type==='button'&&n.props.children===child).props.onClick();assert.deepEqual(chosen.at(-1),[volume,child]);
  assert.deepEqual(props.value.content,content);
 }finally{view.unmount();f.close()}
});

test('新边界：父正文从选取、预览、确认保留到定向修订均走原页面入口',async()=>{
 const volume='技术资信文件',parent='项目管理方案',calls=[],executions=[];
 const section={volume,title:parent,path:'body/项目管理方案.docx',status:'stale'};
 const flow={task:{id:'t'},execution:null,files:[],bidder:{confirmed:true,stale:false},directory:{artifact_id:'d',content_seq:1,
  content:{response_documents:[{name:volume,directory:[{目录名称:parent,level:1,children:[{目录名称:'服务流程',level:2,children:[]}]}]}]}},
  body_sections:[section],body_files:[section.path],build_preparation:{guide:'ready',promises:'ready'},build_preparation_changes:{},volume_states:[],input_versions:{revise:'r'}};
 const f=await fixture(async(url,options)=>{calls.push([url,options]);return response({ok:true})});
 const props={tid:'t',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async(...args)=>{executions.push(args);return true},exportVolume:async()=>{},renderDocument:()=>null};
 const view=f.mount('BuildWorkspace',props);
 try{
  find(view,n=>n.props.statuses).props.onSelect(volume,parent);
  const preview=find(view,n=>n.props.name===section.path&&n.props.url);
  assert.ok(preview.props.url.includes(encodeURIComponent(section.path))||preview.props.url.includes(section.path));
  await find(view,n=>n.type==='button'&&n.props.children==='已核对，保留当前章').props.onClick();await view.settle();
  assert.equal(calls.length,1);assert.ok(calls[0][0].endsWith('/page-flow/t/accept-section'));
  assert.deepEqual(JSON.parse(calls[0][1].body),{volume,title:parent,input_version:'r'});
  assert.ok(!nodes(view.render()).some(n=>n.props.className==='chapter-notice'),'确认成功后立即收起提示，不等待父组件刷新');
  flow.input_versions.revise='new-basis';view.render();
  assert.ok(nodes(view.render()).some(n=>n.props.className==='chapter-notice'),'依据再次变化时重新提示');
  find(view,n=>n.type==='button'&&n.props.children==='修改当前章').props.onClick();
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'仅补充父章节总说明，保留原有内容'}});
  await find(view,n=>n.type==='button'&&text(n)==='确认修改').props.onClick();
  assert.deepEqual(executions[0],['revise',[{volume,title:parent}],{instruction:'仅补充父章节总说明，保留原有内容'}]);
 }finally{view.unmount();f.close()}
});

test('修改当前章列出缺失准备并按依赖补齐，保留选章后即可修订',async()=>{
 const section={volume:'技术部分',title:'实施方案',path:'body/实施方案.docx',status:'ready'};
 const flow={task:{id:'t'},execution:null,files:[],bidder:{confirmed:true,stale:false},directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},body_sections:[section],body_files:[section.path],build_preparation:{guide:'missing',promises:'missing'},volume_states:[],input_versions:{revise:'r'}};
 const executions=[],f=await fixture(async()=>{throw Error('组件不应自行写入准备文件')});
 const props={tid:'t',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async(...args)=>{executions.push(args);return true},exportVolume:async()=>{},renderDocument:()=>null};
 const view=f.mount('BuildWorkspace',props),button=label=>find(view,n=>n.type==='button'&&text(n)===label),preparation=()=>find(view,n=>n.props['aria-label']==='写作准备');
 try{
  find(view,n=>n.props.statuses).props.onSelect(section.volume,section.title);
  assert.equal(button('修改当前章').props.disabled,true);
  assert.match(text(preparation()),/写作指引尚未生成/);assert.match(text(preparation()),/关键事实与承诺尚未生成/);
  assert.match(text(preparation()),/请先完成写作指引/);
  assert.equal(button('补齐关键事实与承诺').props.disabled,true);
  button('补齐写作指引').props.onClick();
  await button('确认生成').props.onClick();await view.settle();
  assert.deepEqual(executions[0],['guide',[],{instruction:''}]);
  // 生成失败或尚未完成时，原缺项入口保留；就绪后只显示下一项。
  assert.match(text(preparation()),/写作指引尚未生成/);
  flow.build_preparation.guide='ready';view.render();
  assert.ok(!nodes(view.render()).some(n=>n.type==='button'&&text(n)==='补齐写作指引'));
  assert.equal(button('补齐关键事实与承诺').props.disabled,false);
  button('补齐关键事实与承诺').props.onClick();await button('确认生成').props.onClick();await view.settle();
  assert.deepEqual(executions[1],['promises',[],{instruction:''}]);
  flow.build_preparation.promises='ready';view.render();
  assert.ok(!nodes(view.render()).some(n=>n.props['aria-label']==='写作准备'));
  assert.equal(button('修改当前章').props.disabled,false);
  button('修改当前章').props.onClick();find(view,n=>n.type==='textarea').props.onChange({target:{value:'只修改本章验收安排'}});
  await button('确认修改').props.onClick();
  assert.deepEqual(executions[2],['revise',[{volume:section.volume,title:section.title}],{instruction:'只修改本章验收安排'}]);
 }finally{view.unmount();f.close()}
});

for(const status of ['stale','missing'])test('已有准备文件'+status+'时引导核对保存，禁止把旧文件当成缺失直接覆盖',async()=>{
 const section={volume:'技术',title:'实施方案',path:'body/实施方案.docx',status:'ready'};
 const guide={path:'body/写作指引.md',content:'人工指引'},promises={path:'body/关键事实与承诺.md',content:'人工承诺'};
 const flow={task:{id:'t'},execution:null,files:[guide,promises],directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},body_sections:[section],body_files:[section.path],build_preparation:{guide:status,promises:status},volume_states:[],input_versions:{revise:'r'}};
 const f=await fixture(async()=>{throw Error('不应联网')}),executions=[];
 const view=f.mount('BuildWorkspace',{tid:'t',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async(...args)=>{executions.push(args);return true},exportVolume:async()=>{},renderDocument:file=>({type:'article',props:{children:file.content}})});
 try{
  find(view,n=>n.props.statuses).props.onSelect(section.volume,section.title);
  const region=find(view,n=>n.props['aria-label']==='写作准备');
  assert.match(text(region),status==='stale'?/依据已变化，请核对并保存/:/已有文件，请核对并保存/);
  const entry=nodes(region).find(n=>n.type==='button'&&text(n)==='核对写作指引');assert.ok(entry);entry.props.onClick();
  assert.ok(nodes(view.render()).some(n=>n.type==='article'&&text(n)==='人工指引'));
  find(view,n=>n.type==='button'&&text(n)==='目录与章节').props.onClick();
  assert.equal(find(view,n=>n.type==='button'&&text(n)==='修改当前章').props.disabled,true);
  flow.build_preparation={guide:'ready',promises:'ready'};view.render();
  assert.equal(find(view,n=>n.type==='button'&&text(n)==='修改当前章').props.disabled,false);
  assert.deepEqual(executions,[]);assert.equal(guide.content,'人工指引');assert.equal(promises.content,'人工承诺');
 }finally{view.unmount();f.close()}
});

test('写作准备只显示一处，合并变化原因、不打开下方核对面板，就绪后自动消失',async()=>{
 const section={volume:'技术',title:'实施方案',path:'body/实施方案.docx',status:'stale'};
 const flow={task:{id:'t'},execution:null,files:[{path:'body/写作指引.md',content:'人工指引'},{path:'body/关键事实与承诺.md',content:'人工承诺'}],directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},body_sections:[section],body_files:[section.path],build_preparation:{guide:'stale',promises:'stale'},build_preparation_changes:{guide:['目录内容或目标篇幅已变化'],promises:['写作指引已变化']},volume_states:[],input_versions:{revise:'r'}};
 const f=await fixture(async()=>{throw Error('不应联网')});
 const view=f.mount('BuildWorkspace',{tid:'t',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async()=>true,exportVolume:async()=>{},renderDocument:()=>null});
 try{
  assert.equal(nodes(view.render()).filter(n=>n.props['aria-label']==='写作准备').length,1,'已存在的准备过期时保留核对入口');
  find(view,n=>n.props.statuses).props.onSelect(section.volume,section.title);
  const tree=nodes(view.render()),region=find(view,n=>n.props['aria-label']==='写作准备');
  assert.equal(tree.filter(n=>n.props['aria-label']==='写作准备').length,1);
  assert.match(text(region),/目录内容或目标篇幅已变化/);assert.match(text(region),/写作指引已变化/);
  assert.ok(!tree.some(n=>n.type==='aside'||n.props.className==='preparation-summary'||n.props.className==='preparation-review'));
  assert.equal(find(view,n=>n.props.className==='build-workspace').props['data-panel-open'],false);
  assert.ok(!tree.some(n=>n.props.className==='chapter-notice'),'准备未就绪时不重复展示无法操作的章节核对提示');
  const preview=find(view,n=>n.props.name===section.path&&n.props.url).props.url;
  flow.build_preparation={guide:'ready',promises:'ready'};view.render();
  assert.ok(!nodes(view.render()).some(n=>n.props['aria-label']==='写作准备'||n.type==='aside'));
  assert.equal(find(view,n=>n.props.name===section.path&&n.props.url).props.url,preview);
  assert.equal(find(view,n=>n.type==='button'&&text(n)==='修改当前章').props.disabled,false);
 }finally{view.unmount();f.close()}
});

test('重新生成当前章须确认覆盖风险，取消不执行，确认锁定章节且防重复提交',async()=>{
 const section={volume:'技术册',title:'实施方案',path:'body/实施方案.docx',status:'ready'},other={volume:'商务册',title:'报价说明',path:'body/报价说明.docx',status:'ready'};
 const flow={task:{id:'t'},execution:null,files:[],directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},body_sections:[section,other],body_files:[section.path,other.path],build_preparation:{guide:'ready',promises:'ready'},volume_states:[],input_versions:{revise:'r'}};
 const executions=[];let finish;
 const f=await fixture(async()=>{throw Error('不应联网')});
 const props={tid:'t',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,syncing:false,onChanged:async()=>{},execute:async(...args)=>{executions.push(args);props.busy=true;try{return await new Promise(resolve=>{finish=resolve})}finally{props.busy=false}},exportVolume:async()=>{},renderDocument:()=>null};
 const view=f.mount('BuildWorkspace',props);
 const button=label=>find(view,n=>n.type==='button'&&text(n)===label),dialog=()=>find(view,n=>n.props.role==='alertdialog'&&n.props.open);
 try{
  find(view,n=>n.props.statuses).props.onSelect(section.volume,section.title);
  button('重新生成当前章').props.onClick();
  assert.equal(executions.length,0);assert.match(text(dialog()),/实施方案.*技术册/);
  assert.match(text(dialog()),/重写.*全部正文，可能覆盖本章的人工修改/);assert.match(text(dialog()),/其他章节保持不变/);
  button('取消').props.onClick();assert.equal(executions.length,0);assert.ok(!nodes(view.render()).some(n=>n.props.role==='alertdialog'&&n.props.open));
  button('重新生成当前章').props.onClick();dialog().props.onClose();assert.equal(executions.length,0);
  button('重新生成当前章').props.onClick();
  // 即使后台选章发生变化，确认仍执行弹窗中明确展示的章节。
  find(view,n=>n.props.statuses).props.onSelect(other.volume,other.title);
  const pending=button('确认重新生成').props.onClick();
  assert.equal(executions.length,1);assert.deepEqual(executions[0].slice(0,2),['body',[{volume:section.volume,title:section.title}]]);
  assert.match(executions[0][2].instruction,/仅重写此章，保留其他正文/);
  assert.equal(button('正在提交…').props.disabled,true);assert.equal(button('取消').props.disabled,true);
  await button('正在提交…').props.onClick();assert.equal(executions.length,1);
  dialog().props.onClose();assert.ok(dialog());finish(false);await pending;
  assert.ok(dialog(),'提交失败允许重试');
  const retry=button('确认重新生成').props.onClick();finish(true);await retry;
  assert.ok(!nodes(view.render()).some(n=>n.props.role==='alertdialog'&&n.props.open));
  // 首次生成没有旧正文可覆盖，保留原来的直接生成入口。
  flow.body_files=[];view.render();button('生成当前章').props.onClick();
  assert.equal(executions.length,3);assert.deepEqual(executions[2].slice(0,2),['body',[{volume:other.volume,title:other.title}]]);finish(true);
 }finally{view.unmount();f.close()}
});
