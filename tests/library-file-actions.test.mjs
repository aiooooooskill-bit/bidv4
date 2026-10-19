import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const button=(view,label)=>find(view,n=>n.type==='button'&&text(n.props.children)===label);
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
const props=(extra={})=>({kind:'kb',name:'营业执照.pdf',path:'/kb/items/k',versionQuery:'revision=8',onChanged(){},...extra});

test('标题操作入口把删除放在更多中，未确认不会发请求',async()=>{
 const calls=[];const f=await fixture(async(...args)=>{calls.push(args);return response({})}),v=f.mount('FileActions',props());
 try{assert.equal(nodes(v.render()).some(n=>n.props.children==='删除资料'),false);button(v,'更多 ▾').props.onClick();button(v,'删除资料').props.onClick();assert.match(text(v.render()),/无法撤销/);assert.equal(calls.length,0);await button(v,'确认删除').props.onClick();await v.settle();assert.equal(calls[0][0],'/api/bidv4/kb/items/k?revision=8');assert.equal(calls[0][1].method,'DELETE')}finally{v.unmount();f.close()}
});

test('更换上传携带版本，处理期间阻止连点与关闭并等待刷新',async()=>{
 let finish,refresh;const pending=new Promise(r=>finish=r),refreshing=new Promise(r=>refresh=r),calls=[],busy=[];
 const f=await fixture(async(...args)=>{calls.push(args);return pending}),v=f.mount('FileActions',props({onBusyChange:b=>busy.push(b),onChanged:()=>refreshing}));
 try{
  button(v,'更换文件').props.onClick();assert.equal(button(v,'确认更换并处理').props.disabled,true);
  find(v,n=>n.props['aria-label']==='选择替换文件').props.onChange({target:{files:[new File(['valid'],'新版.docx')]}});
  const submit=button(v,'确认更换并处理').props.onClick;submit();submit();await v.settle();assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/bidv4/kb/items/k/replace?revision=8');assert.equal(calls[0][1].body.get('file').name,'新版.docx');
  find(v,n=>n.props.label==='更换文件'&&n.props.open).props.onClose();assert.equal(find(v,n=>n.props.label==='更换文件').props.open,true);
  finish(response({id:'k'}));await v.settle();assert.equal(busy.at(-1),true);
  refresh();await v.settle();assert.equal(busy.at(-1),false);assert.equal(find(v,n=>n.props.label==='删除资料').props.open,false);
 }finally{v.unmount();f.close()}
});

test('写作素材分别确认删片段与删整个文件，显示实际关联数量',async()=>{
 const calls=[];const f=await fixture(async(...args)=>{calls.push(args);return response({})}),v=f.mount('FileActions',props({kind:'mt',name:'方案.docx',path:'/materials/files/f',versionQuery:'file_hash=hash',blockCount:3,block:{id:'b',title:'实施素材'}}));
 try{
  button(v,'更多 ▾').props.onClick();button(v,'删除当前素材').props.onClick();assert.match(text(v.render()),/来源文件和其他素材保留/);button(v,'确认删除').props.onClick();await v.settle();assert.equal(calls[0][0],'/api/bidv4/materials/blocks/b');
  button(v,'更多 ▾').props.onClick();button(v,'删除来源文件及全部关联素材').props.onClick();assert.match(text(v.render()),/全部 3 份/);button(v,'确认删除').props.onClick();await v.settle();assert.equal(calls[1][0],'/api/bidv4/materials/files/f?file_hash=hash');
 }finally{v.unmount();f.close()}
});

test('重新识别发完整重跑请求，失败保留说明和重试入口',async()=>{
 let tries=0;const calls=[],f=await fixture(async(...args)=>{calls.push(args);return ++tries===1?response({detail:'资料已更新，请重新读取'},409):response({})}),v=f.mount('FileActions',props());
 try{button(v,'更多 ▾').props.onClick();button(v,'重新识别').props.onClick();assert.match(text(v.render()),/人工核对内容和索引将清除/);button(v,'确认重新处理').props.onClick();await v.settle();assert.match(text(v.render()),/资料已更新/);assert.equal(calls[0][0],'/api/bidv4/kb/items/k/retrigger?revision=8');assert.equal(button(v,'确认重新处理').props.disabled,false)}finally{v.unmount();f.close()}
});

test('上传成功后刷新失败重试只刷新，不重复替换文件',async()=>{
 let uploads=0,refreshes=0;const f=await fixture(async()=>{uploads++;return response({})}),v=f.mount('FileActions',props({onChanged(){if(++refreshes===1)throw Error('刷新失败')}}));
 try{button(v,'更换文件').props.onClick();find(v,n=>n.props['aria-label']==='选择替换文件').props.onChange({target:{files:[new File(['valid'],'新版.pdf')]}});button(v,'确认更换并处理').props.onClick();await v.settle();assert.equal(uploads,1);button(v,'重新读取结果').props.onClick();await v.settle();assert.equal(uploads,1);assert.equal(refreshes,2)}finally{v.unmount();f.close()}
});

test('内置版式禁止更换删除，未保存表单禁止文件操作',async()=>{
 const f=await fixture(async()=>response({}));
 try{for(const extra of [{kind:'template',builtin:true},{disabled:true}]){const v=f.mount('FileActions',props(extra));try{assert.equal(button(v,'更换文件').props.disabled,true);assert.equal(button(v,'更多 ▾').props.disabled,true)}finally{v.unmount()}}}finally{f.close()}
});

test('公司资料原件对照保留内嵌预览并移除外开按钮，重新识别移至标题菜单',async()=>{
 const f=await fixture(async()=>response({})),v=f.mount('KnowledgeDetail',{item:{availability:{usable:true,label:'可用'},id:'k',revision:2,file_hash:'source-hash',title:'证件',file_name:'证件.pdf',company_id:'a',business:{doc_type:'other'},suggested:{},ocr:'文字',original_ocr:'文字',meta:{},parse_status:'ready'},overview:{companies:[],types:[],field_labels:{}},onDirty(){},onSaved(){},onError(){}});
 try{button(v,'原件对照').props.onClick();assert.equal(nodes(v.render()).some(n=>n.type==='a'&&n.props.target==='_blank'),false);assert.ok(find(v,n=>n.props.url==='/api/bidv4/kb/items/k/raw?v=source-hash'));const actions=find(v,n=>n.props.kind==='kb');assert.equal(actions.props.versionQuery,'revision=2');assert.equal(nodes(v.render()).some(n=>n.type==='button'&&n.props.children==='重新整理'),false)}finally{v.unmount();f.close()}
});

test('更换公司文件后清除会隐藏新识别记录的正文、类型和核对状态筛选',async()=>{
 const calls=[],item={id:'k',revision:2,file_hash:'source-hash',title:'证件',file_name:'证件.pdf',company_id:'a',business:{doc_type:'other'},suggested:{},content:'旧全文',original_content:'旧全文',meta:{},parse_status:'ready',review_status:'confirmed',availability:{usable:true,label:'可用'}};
 const f=await fixture(async url=>{calls.push(url);return response(url.includes('?')?{items:[item],total:1,page:1,pages:1,page_size:5}:item)});
 const p={overview:{companies:[],types:[],field_labels:{}},epoch:0,dirty:false,onDirty(){},onError(){},onSaved:async()=>{p.epoch++}},v=f.mount('Knowledge',p);
 try{
  await v.settle();find(v,n=>n.props['aria-label']==='公司资料检索').props.onChange({target:{value:'旧全文'}});find(v,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  find(v,n=>n.props['aria-label']==='核对状态筛选').props.onChange({target:{value:'confirmed'}});await v.settle();
  await find(v,n=>n.props.item?.id==='k').props.onFileChanged('文件已更换','replace');await v.settle();
  const latest=new URL(calls.findLast(u=>u.includes('/kb/items?')),'http://fixture');assert.equal(latest.searchParams.get('q'),'');assert.equal(latest.searchParams.get('doc_type'),'');assert.equal(latest.searchParams.get('review_status'),'');assert.equal(latest.searchParams.get('page'),'1');
 }finally{v.unmount();f.close()}
});

test('更换素材来源后重新打开准确来源的章节选择并清除旧检索',async()=>{
 let replaced=false;
 const f=await fixture(async url=>{const file={id:'f',file_name:replaced?'新方案.docx':'旧方案.docx',file_hash:replaced?'new':'old',parse_status:'ready',block_count:replaced?0:3};return response(url.endsWith('/files')?{files:[file]}:{items:[replaced?{...file,kind:'file'}:{kind:'block',id:'b',file_id:'f',file_name:file.file_name,title:'旧素材',ranges:[[1,2]],chars:30,parse_status:'ready'}],total:1,page:1,pages:1,page_size:5})});
 const p={overview:{companies:[],types:[],field_labels:{}},epoch:0,dirty:false,onDirty(){},onError(){},onSaved:async()=>{p.epoch++}},v=f.mount('Materials',p);
 try{
  await v.settle();const detail=find(v,n=>n.props.item?.id==='b');replaced=true;await detail.props.onFileChanged('来源已更换','replace');await v.settle();
  const picker=find(v,n=>n.props.fid==='f');assert.equal(picker.props.fileName,'新方案.docx');assert.equal(find(v,n=>n.props.label==='从文件建立素材').props.open,true);assert.equal(find(v,n=>n.props['aria-label']==='素材来源筛选').props.value,'f');
 }finally{v.unmount();f.close()}
});
