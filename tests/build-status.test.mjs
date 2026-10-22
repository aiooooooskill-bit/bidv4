import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,questionInput} from './helpers/component-fixture.mjs';

const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
const flowFor=({total=4,generated=2,volumes=3,ready=1,page=64}={})=>{
 const body_sections=Array.from({length:total},(_,i)=>({volume:'技术',title:`第${i+1}章`,path:`body/第${i+1}章.docx`,status:i<generated?'ready':'missing'}));
 return {bidder:{confirmed:true,stale:false},task:{id:'t1'},execution:null,files:[],directory:{artifact_id:'dir',content_seq:1,content:{page_target:page,response_documents:[{name:'技术',directory:[{目录名称:'父章节',level:1,children:[{目录名称:'子章节甲',level:2},{目录名称:'子章节乙',level:2}]}]},{name:'商务',directory:[{目录名称:'投标函',level:1}]}]}},body_sections,body_files:body_sections.slice(0,generated).map(s=>s.path),build_preparation:{guide:'ready',promises:'ready'},build_preparation_changes:{guide:[],promises:[]},volume_states:Array.from({length:volumes},(_,i)=>({name:`第${i+1}册`,status:i<ready?'ready':'missing'})),input_versions:{revise:'v1'}};
};
const propsFor=flow=>({tid:'t1',mode:'build',flow,input:questionInput(),artifacts:[],disabled:false,busy:false,onChanged:async()=>{},execute:async()=>true,exportVolume:async()=>{},renderDocument:()=>null,checksPanel:null});
const status=view=>find(view,n=>n.props.className==='build-status');
const state=view=>find(view,n=>n.props.className==='build-status-execution');

for(const options of [{total:4,generated:2,volumes:3,ready:1,page:64},{total:9,generated:7,volumes:2,ready:2,page:null}])test(`紧凑状态栏呈现项目真实数量与篇幅：正文${options.generated}/${options.total}，整册${options.ready}/${options.volumes}`,async()=>{
 const f=await fixture(async()=>{throw new Error('no network expected')}),view=f.mount('BuildWorkspace',propsFor(flowFor(options)));
 try{
  const metrics=find(view,n=>n.props.className==='build-status-metrics');
  assert.match(text(metrics),/目录已保存4 项/,'目录项包含两册的父节点和子节点');
  assert.ok(find(view,n=>n.props['aria-label']===`正文生成进度：${options.generated} / ${options.total} 章`));
  assert.ok(find(view,n=>n.props['aria-label']===`整册就绪：${options.ready} / ${options.volumes} 册`));
  assert.ok(text(metrics).includes(options.page==null?'不限篇幅':`目标 ${options.page} 页`));
  assert.equal(nodes(status(view)).filter(n=>n.type==='progress').length,0);
  assert.equal(text(state(view)),'待开始');
 }finally{view.unmount();f.close()}
});

test('等待状态只报告实际阶段，核对入口唯一留在紧凑提醒条，收起后仍可浏览目录',async()=>{
 const flow=flowFor();flow.execution={session_id:'s1',state:'needs_input',kind:'build',questions:[{callId:'q1',questions:[{id:'term',header:'服务期限',question:'服务期限是多少？'}]}]};
 const f=await fixture(async()=>{throw new Error('no network expected')}),view=f.mount('BuildWorkspace',propsFor(flow));
 try{
  assert.match(text(state(view)),/等待服务期限答复/);
  assert.doesNotMatch(text(status(view)),/填写|处理待办|核对面板|补充.*后继续/);
  assert.deepEqual(nodes(status(view)).filter(n=>n.type==='button').map(n=>n.props.children),['停止']);
  assert.equal(nodes(view.render()).filter(n=>n.type==='button'&&n.props.children==='收起核对面板').length,1);
  find(view,n=>n.type==='button'&&n.props.children==='收起核对面板').props.onClick();
  assert.equal(nodes(view.render()).filter(n=>n.type==='button'&&n.props.children==='打开核对面板').length,1);
  assert.ok(find(view,n=>n.props.onSelect));assert.equal(nodes(view.render()).filter(n=>n.type==='aside').length,0);
  assert.doesNotMatch(text(status(view)),/填写|处理待办|核对面板/);
 }finally{view.unmount();f.close()}
});

test('运行、失败、停止和完成按当前执行与真实准备状态判定，附加章节和未保存信息保留',async()=>{
 const flow=flowFor(),props=propsFor(flow),f=await fixture(async()=>{throw new Error('no network expected')}),guard=f.mount('NavigationGuard',{children:null}),view=f.mount('BuildWorkspace',props);
 try{
  flow.execution={session_id:'s1',state:'running',kind:'body',sections:[{volume:'技术',title:'实施方案'}],questions:[]};
  assert.match(text(state(view)),/正在生成实施方案/);
  flow.body_sections[0].status='draft';flow.body_sections[1].status='stale';flow.body_sections[2].status='unverified';
  assert.match(text(status(view)),/1 章待完成/);assert.match(text(status(view)),/2 章待核对或更新/);
  const context=guard.render().props.value;context.mark('t1:document',true);guard.render();
  assert.match(text(status(view)),/请先保存当前修改，再发起制作操作。/);
  assert.equal(find(view,n=>n.type==='button'&&n.props.children==='继续制作标书').props.disabled,true);
  context.mark('t1:document',false);guard.render();
  flow.execution={...flow.execution,state:'failed',error:'生成失败'};assert.match(text(state(view)),/章节生成未完成/);assert.match(text(status(view)),/请查看错误提示/);
  flow.execution={...flow.execution,state:'stopped'};assert.equal(text(state(view)),'已停止');
  flow.execution={...flow.execution,state:'completed'};assert.equal(text(state(view)),'本轮已结束');
  flow.body_sections.forEach(section=>section.status='ready');flow.body_files=flow.body_sections.map(section=>section.path);flow.volume_states.forEach(volume=>volume.status='ready');
  assert.equal(text(state(view)),'标书已制作');assert.equal(find(view,n=>n.type==='button'&&n.props.children==='标书已制作').props.disabled,true);
  flow.build_preparation.guide='stale';assert.equal(text(state(view)),'本轮已结束','准备过期后不能沿用整本已制作状态');
  assert.equal(nodes(view.render()).filter(n=>n.props['aria-label']==='写作准备').length,1);
  assert.ok(!nodes(view.render()).some(n=>n.props.className==='preparation-summary'||n.type==='aside'));
  assert.ok(find(view,n=>n.type==='button'&&text(n)==='补齐写作指引'));
 }finally{view.unmount();guard.unmount();f.close()}
});

test('尚未生成目录时不伪造目录保存、项目篇幅或制作完成',async()=>{
 const flow=flowFor({total:0,generated:0,volumes:0,ready:0});flow.directory=null;
 const f=await fixture(async()=>{throw new Error('no network expected')}),view=f.mount('BuildWorkspace',propsFor(flow));
 try{assert.match(text(status(view)),/目录未生成/);assert.match(text(status(view)),/篇幅待设置/);assert.doesNotMatch(text(status(view)),/目录已保存|标书已制作|目标 64 页/);assert.equal(text(state(view)),'待开始')}
 finally{view.unmount();f.close()}
});
