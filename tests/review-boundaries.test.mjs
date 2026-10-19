import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {fixture,find,nodes,response,questionInput} from './helpers/component-fixture.mjs';
import {checkInstallation} from '../server/installation.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);

test('安装与启用不要求外部排版软件',async()=>{
 const result=await checkInstallation(root,{dshVersion:'0.2.0-rc.2'});
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
  find(view,n=>n.type==='button'&&n.props.children==='修改当前章').props.onClick();
  find(view,n=>n.type==='textarea').props.onChange({target:{value:'仅补充父章节总说明，保留原有内容'}});
  await find(view,n=>n.type==='button'&&text(n)==='确认修改').props.onClick();
  assert.deepEqual(executions[0],['revise',[{volume,title:parent}],{instruction:'仅补充父章节总说明，保留原有内容'}]);
 }finally{view.unmount();f.close()}
});
