import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const overview={companies:[{id:'a',name:'甲公司',revision:1,profile:{legal_name:'甲法人'}},{id:'b',name:'乙公司',revision:1,profile:{}}],representatives:[{id:'r',name:'通用代表',title:'经理',phone:'',email:'',note:'',revision:1}],types:[],field_labels:{}};
const shared=()=>({overview,dirty:false,onDirty(){},onSaved(){},onError(e){throw e},epoch:0});
const control=(v,text)=>find(v,n=>n.type==='button'&&n.props.children===text);
const textOf=n=>typeof n==='string'?n:Array.isArray(n)?n.map(textOf).join(''):n?.props?textOf(n.props.children):'';

test('上传文件零素材时仍显示文件名及建立入口，保存后清除旧检索并显示新素材',async()=>{
 const calls=[];let saved=false;
 const f=await fixture(async url=>{calls.push(url);return response(url.endsWith('/materials/files')?{files:[{id:'f',file_name:'售后服务方案.docx',parse_status:'ready',block_count:saved?1:0}]}:{items:saved?[{kind:'block',parse_status:'ready',id:'m',file_id:'f',file_name:'售后服务方案.docx',title:'服务方式',ranges:[[1,2]],chars:30}]:[{kind:'file',id:'f',file_name:'售后服务方案.docx',parse_status:'ready',block_count:0}],total:1,page:1,pages:1,page_size:5})});
 const props={...shared(),onSaved(){props.epoch++}};const v=f.mount('Materials',props);
 try{
  await v.settle();assert.match(textOf(v.render()),/售后服务方案.docx/);assert.match(textOf(v.render()),/待选章节/);
  find(v,n=>n.props['aria-label']==='写作素材检索').props.onChange({target:{value:'旧关键词'}});find(v,n=>n.type==='form').props.onSubmit({preventDefault(){}});await v.settle();
  control(v,'选择章节建立素材').props.onClick();await v.settle();
  const editor=find(v,n=>n.props.fid==='f');saved=true;await editor.props.onChanged();await v.settle();assert.match(textOf(v.render()),/服务方式/);
  assert.equal(find(v,n=>n.props['aria-label']==='写作素材检索').props.value,'');
  assert.equal(find(v,n=>n.props.label==='从文件建立素材').props.open,false);
  assert.ok(calls.some(u=>u.includes('q=%E6%97%A7')));
 }finally{v.unmount();f.close()}
});

test('上传成功把准确文件id交给章节选择流程',async()=>{
 const completed=[];const f=await fixture(async url=>{assert.ok(url.endsWith('/materials/files'));return response({id:'new-file'})});
 const v=f.mount('Upload',{kind:'mt',overview,onClose(){},onDone:(...args)=>completed.push(args)});
 try{
  find(v,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new File(['example'],'方案.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})]}});
  control(v,'上传并选择章节').props.onClick();await v.settle();assert.equal(completed[0][1],'new-file');
 }finally{v.unmount();f.close()}
});

test('新上传文件直接打开选择章节，且不受先前检索条件影响',async()=>{
 let handled=0;const f=await fixture(async url=>response(url.endsWith('/files')?{files:[{id:'new',file_name:'新方案.docx',parse_status:'ready',block_count:0}]}:{items:[],total:0,page:1,pages:1,page_size:5}));
 const v=f.mount('Materials',{...shared(),uploadedFileId:'new',onUploadHandled:()=>handled++});
 try{await v.settle();assert.equal(find(v,n=>n.props.fid==='new').props.fid,'new');assert.equal(find(v,n=>n.props.label==='从文件建立素材').props.open,true);assert.equal(handled,1)}finally{v.unmount();f.close()}
});

for(const status of ['pending','failed','empty'])test('章节选择明确呈现状态并可重新读取 '+status,async()=>{
 let reads=0;const calls=[];const f=await fixture(async(url,options={})=>{calls.push([url,options.method]);if(options.method)return response({ok:true});reads++;return response(reads>1?{parse_status:'ready',outline:[{标题:'服务方式',start_line:1,end_line:3}]}:{parse_status:status==='empty'?'ready':status,outline:[],error:status==='failed'?'文档损坏':null})},{realMaterialBlocks:true});
 const v=f.mount('MaterialBlocks',{fid:'f',onChanged:async()=>{}});
 try{await v.settle();assert.equal(control(v,'保存所选素材').props.disabled,true);assert.match(textOf(v.render()),status==='pending'?/正在解析/:status==='failed'?/解析失败.*文档损坏/:/未识别到可选章节/);await control(v,status==='pending'?'重新读取目录':'重新解析').props.onClick();await v.settle();assert.match(textOf(v.render()),/服务方式/);if(status!=='pending')assert.ok(calls.some(([url,method])=>url.endsWith('/reparse')&&method==='POST'))}finally{v.unmount();f.close()}
});

test('选择章节和命名后保存准确区间，成功后通知列表刷新',async()=>{
 let changed=0;const writes=[];const f=await fixture(async(_url,options={})=>{if(options.method){writes.push(JSON.parse(options.body));return response({id:'m'})}return response({parse_status:'ready',outline:[{标题:'服务方式',start_line:2,end_line:9}]})},{realMaterialBlocks:true});
 const v=f.mount('MaterialBlocks',{fid:'f',onChanged:async()=>{changed++}});
 try{await v.settle();find(v,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});find(v,n=>n.type==='input'&&n.props.value==='').props.onChange({target:{value:'服务方案'}});control(v,'保存所选素材').props.onClick();await v.settle();assert.deepEqual(writes[0],{title:'服务方案',note:'',ranges:[[2,9]]});assert.equal(changed,1)}finally{v.unmount();f.close()}
});

test('授权代表无主体也能新增，列表不按主体筛选',async()=>{
 const writes=[];const f=await fixture(async(_url,options={})=>{writes.push(JSON.parse(options.body));return response({id:'r2'})});
 const v=f.mount('RepresentativeDetail',{onDirty(){},onSaved(){},onError(e){throw e}});
 try{find(v,n=>n.props['aria-label']==='代表姓名').props.onChange({target:{value:'李代表'}});assert.equal(nodes(v.render()).some(n=>n.type==='select'),false);assert.equal(control(v,'保存授权代表').props.disabled,false);await control(v,'保存授权代表').props.onClick();assert.equal(writes[0].name,'李代表');assert.equal('company_id' in writes[0],false)}finally{v.unmount();f.close()}
});

test('主体确认必须选择代表，切换主体保留通用代表，并按项目保存',async()=>{
 const writes=[];const f=await fixture(async(url,options={})=>{if(options.method){writes.push(JSON.parse(options.body));return response({})}return response(overview)});
 const v=f.mount('BidderForm',{tid:'t',state:{revision:0},onClose(){},onSaved:async()=>{}});
 try{
  await v.settle();const company=()=>find(v,n=>n.props.companies===overview.companies||n.props.label==='所属主体'||n.props.companies?.length===2);
  company().props.onChange('a');
  const rep=()=>find(v,n=>n.props['aria-label']==='本次授权代表');
  assert.ok(nodes(rep()).some(n=>n.type==='option'&&n.props.value==='r'));
  find(v,n=>n.props['aria-label']==='本次签署日期').props.onChange({target:{value:'2026-10-15'}});
  assert.equal(control(v,'确认并用于制作').props.disabled,true);
  rep().props.onChange({target:{value:'r'}});company().props.onChange('b');assert.equal(rep().props.value,'r');
  await control(v,'确认并用于制作').props.onClick();assert.equal(writes[0].company_id,'b');assert.equal(writes[0].signer_id,'r');
 }finally{v.unmount();f.close()}
});

test('点击标题只定位原文，复选框与全选只改勾选，目录始终保留',async()=>{
 const calls=[],located=[];
 const outline=[{标题:'服务方式',start_line:1,end_line:9},{标题:'服务方式',start_line:10,end_line:18}];
 const f=await fixture(async url=>{calls.push(url);return response({parse_status:'ready',outline})},{realMaterialBlocks:true});
 const v=f.mount('MaterialBlocks',{fid:'f',onChanged:async()=>{},onNavigate:node=>located.push(node)});
 try{
  await v.settle();
  const titles=()=>nodes(v.render()).filter(n=>n.props.className==='material-chapter-title');
  titles()[1].props.onClick();assert.equal(located[0].start_line,10);
  assert.equal(nodes(v.render()).filter(n=>n.type==='input'&&n.props.checked).length,0);
  assert.equal(titles().length,2);assert.equal(calls.length,1);
  assert.ok(!nodes(v.render()).some(n=>n.props.children==='查看内容'||n.props.children==='返回目录'));
  find(v,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  control(v,'全选目录').props.onClick();assert.equal(located.length,1);
  assert.equal(nodes(v.render()).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked).length,2);
  assert.equal(calls.length,1);
 }finally{v.unmount();f.close()}
});

test('当前查看章节与勾选状态独立，加载原文时仍保留目录与素材信息',async()=>{
 const outline=[{标题:'甲章',start_line:1,end_line:5},{标题:'乙章',start_line:6,end_line:10}];
 const f=await fixture(async()=>response({parse_status:'ready',outline}),{realMaterialBlocks:true});
 const v=f.mount('MaterialBlocks',{fid:'f',onChanged:async()=>{},onNavigate(){},activeLine:6,navigationStatus:'正在打开原文：乙章…'});
 try{
  await v.settle();assert.equal(find(v,n=>n.props['aria-current']==='location').props.children,'乙章');
  assert.equal(nodes(v.render()).filter(n=>n.type==='input'&&n.props.checked).length,0);
  assert.equal(find(v,n=>n.props['aria-label']==='素材名称').type,'input');
  assert.match(textOf(v.render()),/正在打开原文：乙章/);
  assert.equal(nodes(v.render()).filter(n=>n.props.className==='material-chapter-title').length,2);
 }finally{v.unmount();f.close()}
});
