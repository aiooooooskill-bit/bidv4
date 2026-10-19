import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const availability={usable:true,has_text:true,has_fields:false,source:'human',label:'有人工核对内容'};
const overview={companies:[{id:'a',name:'公司甲',revision:1,profile:{phone:'123'}}],representatives:[],types:[{code:'other',name:'其他'}],field_labels:{}};
const shared=()=>({overview,dirty:false,onDirty(){},onSaved(){},onError(){},epoch:0});
const button=(view,text)=>find(view,n=>n.type==='button'&&(Array.isArray(n.props.children)?n.props.children.join(''):n.props.children)===text);

for(const [component,extra] of [
 ['CompanyDetail',{company:overview.companies[0]}],
 ['RepresentativeDetail',{rep:{id:'r',name:'张三',revision:1,title:'经理',phone:'123',email:'',note:''}}],
 ['KnowledgeDetail',{item:{availability,id:'k',revision:1,title:'证件',company_id:'a',business:{doc_type:'other'},suggested:{},ocr:'核对文字',original_ocr:'机器文字',meta:{},parse_status:'ready'}}],
 ['MaterialDetail',{item:{id:'m',title:'方案',note:'用途',file_id:'f',file_name:'方案.docx'}}],
])test(component+' 保存期间锁定输入并保留离开保护',async()=>{
 let finish;const pending=new Promise(r=>finish=r);const marks=[],saves=[];
 const f=await fixture(async(_url,options={})=>options.method?pending:response({sections:[]}));
 const view=f.mount(component,{...shared(),...extra,onDirty:v=>marks.push(v),onSaved:v=>saves.push(v)});
 try{
  if(component==='MaterialDetail')button(view,'名称与用途').props.onClick();
  find(view,n=>n.type==='input').props.onChange({target:{value:'本地修改'}});
  const save=find(view,n=>n.type==='button'&&n.props.className==='primary');const work=save.props.onClick();
  await view.settle();
  assert.equal(marks.at(-1),true);
  const editors=nodes(view.render()).filter(n=>['input','textarea','select'].includes(n.type));
  assert.ok(editors.length);assert.ok(editors.every(n=>n.props.disabled===true));
  finish(response({id:'saved',availability}));await work;await view.settle();assert.equal(saves.length,1);
 }finally{view.unmount();f.close()}
});

test('当前栏目点击不丢弃草稿且不清除导航保护',async()=>{
 const f=await fixture(async url=>response(url.includes('/kb/types')?{types:[],field_labels:{}}:overview));
 const guard=f.mount('NavigationGuard',{children:null}),view=f.mount('Library');
 try{
  await guard.settle();await view.settle();
  find(view,n=>n.props.epoch===1&&n.props.overview).props.onDirty(true);await guard.settle();
  assert.equal(f.api.useNavigationGuard().hasDirty,true);
  button(view,'公司资料').props.onClick();await guard.settle();
  assert.equal(f.api.useNavigationGuard().hasDirty,true);
  assert.equal(nodes(guard.render()).find(n=>n.props.label==='未保存修改').props.open,false);
 }finally{view.unmount();guard.unmount();f.close()}
});

test('409后读取最新主体版本保留本地草稿，核对后按新revision保存',async()=>{
 let conflicted=true;const bodies=[];const latest={...overview.companies[0],name:'其他人保存',profile:{phone:'456'},revision:2};
 const f=await fixture(async(url,options={})=>{
  if(options.method){bodies.push(JSON.parse(options.body));if(conflicted){conflicted=false;return response({detail:'版本冲突'},409)}return response({id:'a'})}
  assert.ok(url.endsWith('/library/overview'));return response({...overview,companies:[latest]});
 });
 const marks=[],view=f.mount('CompanyDetail',{...shared(),company:overview.companies[0],onDirty:v=>marks.push(v)});
 try{
  find(view,n=>n.props['aria-label']==='公司全称').props.onChange({target:{value:'我的草稿'}});
  await button(view,'保存主体信息').props.onClick();await view.settle();
  assert.equal(button(view,'保存主体信息').props.disabled,true);
  await button(view,'读取最新版本并保留当前输入').props.onClick();await view.settle();
  assert.equal(find(view,n=>n.props['aria-label']==='公司全称').props.value,'我的草稿');
  assert.equal(marks.at(-1),true);
  assert.ok(find(view,n=>n.type==='dd'&&n.props.children==='其他人保存')); 
  button(view,'已核对差异，保留当前输入').props.onClick();await view.settle();
  await button(view,'保存主体信息').props.onClick();
  assert.equal(bodies.at(-1).revision,2);assert.equal(bodies.at(-1).name,'我的草稿');
 }finally{view.unmount();f.close()}
});

test('资料详情一次读取字段、核对文字和revision，避免跨请求混用',async()=>{
 const calls=[],item={availability,id:'k',company_id:'a',revision:7,file_name:'证件.png',title:'证件',business:{doc_type:'other'},suggested:{},content:'同一版本核对全文',original_content:'原始转写',meta:{},parse_status:'ready'};
 const f=await fixture(async url=>{calls.push(url);return response(url.includes('?')?{items:[item],total:1,page:1,pages:1,page_size:5}:item)});
 const view=f.mount('Knowledge',shared());
 try{await view.settle();const detail=find(view,n=>n.props.item?.id==='k');assert.equal(detail.props.item.revision,7);assert.equal(detail.props.item.ocr,'同一版本核对全文');assert.equal(calls.filter(u=>u.endsWith('/k')).length,1);assert.equal(calls.some(u=>u.endsWith('/content')),false)}finally{view.unmount();f.close()}
});

for(const key of ['规范#1.docx','规范?1.docx','带 空格&符号.docx'])test('版式预览和启用编码文件名 '+key,async()=>{
 const calls=[];const f=await fixture(async(url,options={})=>{calls.push(url);return response(options.method?{}:[{key,name:key,active:false}])});
 const view=f.mount('Templates',shared());
 try{
  await view.settle();const preview=find(view,n=>n.props.url&&n.props.name);
  assert.equal(new URL(preview.props.url,'http://fixture').pathname,'/api/bidv4/templates/'+encodeURIComponent(key)+'/raw');
  await button(view,'设为默认版式').props.onClick();assert.ok(calls.includes('/api/bidv4/templates/'+encodeURIComponent(key)+'/activate'));
 }finally{view.unmount();f.close()}
});

test('授权代表409恢复使用新revision并保留人员输入',async()=>{
 const rep={id:'r',revision:1,name:'张三',title:'经理',phone:'123',email:'',note:''};let conflict=true;const bodies=[];
 const f=await fixture(async(_url,options={})=>{
  if(options.method){bodies.push(JSON.parse(options.body));if(conflict){conflict=false;return response({detail:'版本冲突'},409)}return response({id:'r'})}
  return response({...overview,representatives:[{...rep,revision:2,phone:'456'}]});
 });
 const view=f.mount('RepresentativeDetail',{...shared(),rep});
 try{
  find(view,n=>n.props['aria-label']==='代表姓名').props.onChange({target:{value:'我的代表草稿'}});
  await button(view,'保存授权代表').props.onClick();await view.settle();
  await button(view,'读取最新版本并保留当前输入').props.onClick();await view.settle();
  button(view,'已核对差异，保留当前输入').props.onClick();await view.settle();
  await button(view,'保存授权代表').props.onClick();assert.equal(bodies.at(-1).revision,2);assert.equal(bodies.at(-1).name,'我的代表草稿');
 }finally{view.unmount();f.close()}
});

test('保存回执到达后仍锁定输入直到详情刷新结束',async()=>{
 let finishRefresh;const refreshing=new Promise(r=>finishRefresh=r);const f=await fixture(async()=>response({id:'a'}));
 const view=f.mount('CompanyDetail',{...shared(),company:overview.companies[0],onSaved:()=>refreshing});
 try{
  find(view,n=>n.props['aria-label']==='公司全称').props.onChange({target:{value:'已保存草稿'}});button(view,'保存主体信息').props.onClick();await view.settle();
  assert.equal(find(view,n=>n.props['aria-label']==='公司全称').props.disabled,true);
  finishRefresh();await view.settle();
 }finally{view.unmount();f.close()}
});

test('丢弃并离开详情后旧保存回执不清除新草稿保护或刷新新表单',async()=>{
 let finish;const pending=new Promise(r=>finish=r);let changed=0;const marks=[];
 const f=await fixture(async()=>pending),view=f.mount('CompanyDetail',{...shared(),company:overview.companies[0],onDirty:v=>marks.push(v),onSaved:()=>changed++});
 try{
  find(view,n=>n.props['aria-label']==='公司全称').props.onChange({target:{value:'旧页保存'}});button(view,'保存主体信息').props.onClick();await view.settle();view.unmount();
  marks.push(true);const protectedCount=marks.length;finish(response({id:'a'}));await view.settle();
  assert.equal(changed,0);assert.equal(marks.length,protectedCount);assert.equal(marks.at(-1),true);
 }finally{f.close()}
});

test('资料库保存期间栏目不可切换，防止刷新覆盖另一栏新草稿',async()=>{
 const f=await fixture(async url=>response(url.includes('/kb/types')?{types:[],field_labels:{}}:overview));const view=f.mount('Library');
 try{await view.settle();find(view,n=>n.props.epoch===1&&n.props.overview).props.onDirty(true,true);await view.settle();const nav=find(view,n=>n.type==='nav');assert.ok(nodes(nav).filter(n=>n.type==='button').every(n=>n.props.disabled===true))}finally{view.unmount();f.close()}
});

test('识别尚无结构化结果时冲突恢复不崩溃且保留人工字段草稿',async()=>{
 const item={availability,id:'k',revision:1,title:'待核对资料',company_id:'a',business:{doc_type:'other',extra:{证号:{value:'旧证号'}}},suggested:{},ocr:'旧识别文字',original_ocr:'旧识别文字',meta:{},parse_status:'ready',extract_status:'failed'};
 let reading=0,writing=0;const saved=[];
 const f=await fixture(async(_url,options={})=>{
  if(options.method){saved.push(JSON.parse(options.body));return writing++?response({id:'k'}):response({detail:'资料正在识别'},409)}
  return ++reading===1?response({...item,revision:2,business:null,suggested:null,content:'',original_content:'',parse_status:'pending'}):response({...item,revision:3,content:'新识别文字',original_content:'新识别文字',extract_status:'done'});
 });
 const view=f.mount('KnowledgeDetail',{...shared(),item});
 try{
  find(view,n=>n.props['aria-label']==='字段值 证号').props.onChange({target:{value:'人工新证号'}});
  await button(view,'保存并核对').props.onClick();await view.settle();
  await button(view,'读取最新版本并保留当前输入').props.onClick();await view.settle();
  assert.equal(find(view,n=>n.props['aria-label']==='字段值 证号').props.value,'人工新证号');
  assert.equal(button(view,'保存并核对').props.disabled,true);
  await button(view,'重新读取最新版本并保留当前输入').props.onClick();await view.settle();
  button(view,'已核对差异，保留当前输入').props.onClick();await view.settle();
  await button(view,'保存并核对').props.onClick();
  assert.equal(saved.at(-1).revision,3);assert.equal(saved.at(-1).business.extra.证号.value,'人工新证号');
 }finally{view.unmount();f.close()}
});
