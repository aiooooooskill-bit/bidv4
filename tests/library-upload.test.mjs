import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const overview={companies:[{id:'c',name:'甲公司',profile:{}}],representatives:[],types:[],field_labels:{}};
const button=(view,text)=>find(view,n=>n.type==='button'&&n.props.children===text);
const choose=(view,file)=>find(view,n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});
const file=(name,size=100)=>{const value=new File(['data'],name);Object.defineProperty(value,'size',{value:size});return value};

test('公司资料先确认主体再上传，成功状态不冒充识别完成',async()=>{
 const calls=[],done=[];const f=await fixture(async(url,options={})=>{calls.push([url,options]);return response({id:'kb'})});const view=f.mount('Upload',{kind:'kb',overview,onClose(){},onDone:(...args)=>done.push(args)});
 try{
  choose(view,file('证照.pdf'));button(view,'下一步').props.onClick();assert.equal(calls.length,0);assert.equal(button(view,'确认归属并上传').props.disabled,true);
  find(view,n=>n.props.label==='所属主体'||n.props.companies?.length===1).props.onChange('c');button(view,'确认归属并上传').props.onClick();await view.settle();
  assert.equal(calls[0][0],'/api/bidv4/kb/files?company_id=c');assert.equal(calls[0][1].body.get('file').name,'证照.pdf');assert.equal(done.length,0);
  const result=find(view,n=>n.props.className==='library-upload-result');assert.match(JSON.stringify(result),/识别整理完成后/);
  button(view,'查看公司资料').props.onClick();await view.settle();assert.equal(done.length,1);
 }finally{view.unmount();f.close()}
});

test('Word版式只收DOCX和20MB以内文件，确认后走版式接口',async()=>{
 const calls=[],done=[];const f=await fixture(async(url,options)=>{calls.push([url,options]);return response({key:'排版.docx',name:'排版'})});const view=f.mount('Upload',{kind:'template',overview,onClose(){},onDone:(...args)=>done.push(args)});
 try{
  choose(view,file('错误.pdf'));assert.equal(button(view,'下一步').props.disabled,true);assert.match(JSON.stringify(view.render()),/仅支持 DOCX/);
  choose(view,file('超限.docx',21*1024*1024));assert.equal(button(view,'下一步').props.disabled,true);assert.match(JSON.stringify(view.render()),/20 MB/);assert.equal(calls.length,0);
  choose(view,file('排版.docx'));button(view,'下一步').props.onClick();button(view,'确认上传').props.onClick();await view.settle();
  assert.equal(calls[0][0],'/api/bidv4/templates');button(view,'查看 Word 版式').props.onClick();await view.settle();assert.equal(done.length,1);
 }finally{view.unmount();f.close()}
});

test('写作素材拒绝PDF，拖拽多文件时不静默只上传第一个',async()=>{
 const f=await fixture(async()=>{throw Error('must not upload')});const view=f.mount('Upload',{kind:'mt',overview,onClose(){},onDone(){}});
 try{
  choose(view,file('参考.pdf'));assert.equal(button(view,'上传并选择章节').props.disabled,true);
  find(view,n=>n.props.className==='library-upload-drop').props.onDrop({preventDefault(){},dataTransfer:{files:[file('a.docx'),file('b.docx')]}});
  assert.match(JSON.stringify(view.render()),/每次请选择一个文件/);
 }finally{view.unmount();f.close()}
});

test('上传中禁止重复提交和关闭；失败后保留文件可重试',async()=>{
 let resolve,calls=0,closed=0;const pending=new Promise(r=>resolve=r);const f=await fixture(async()=>{calls++;return calls===1?pending:response({id:'f'})});const view=f.mount('Upload',{kind:'mt',overview,onClose:()=>closed++,onDone(){}});
 try{
  choose(view,file('方案.docx'));const submit=button(view,'上传并选择章节').props.onClick;submit();submit();await view.settle();assert.equal(calls,1);assert.equal(find(view,n=>n.type==='progress').props.value,100);assert.match(JSON.stringify(view.render()),/正在解析章节目录/);
  find(view,n=>n.props.label==='上传写作素材').props.onClose();assert.equal(closed,0);
  resolve(response({detail:'上传失败'},500));await view.settle();assert.match(JSON.stringify(view.render()),/上传失败/);assert.equal(button(view,'上传并选择章节').props.disabled,false);
  button(view,'上传并选择章节').props.onClick();await view.settle();assert.equal(calls,2);
 }finally{view.unmount();f.close()}
});

test('章节全选包含所有层级；取消子章节同时去掉覆盖它的父区间',async()=>{
 const writes=[];const outline=[{标题:'售后方案',start_line:1,end_line:30,children:[{标题:'服务方式',start_line:2,end_line:10},{标题:'响应时间',start_line:11,end_line:20}]}];
 const f=await fixture(async(_url,options={})=>{if(options.method){writes.push(JSON.parse(options.body));return response({id:'m'})}return response({parse_status:'ready',outline})},{realMaterialBlocks:true});const view=f.mount('MaterialBlocks',{fid:'f',onChanged:async()=>{}});
 try{
  await view.settle();button(view,'全选目录').props.onClick();assert.equal(nodes(view.render()).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked).length,3);
  button(view,'取消全选').props.onClick();assert.equal(nodes(view.render()).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked).length,0);
  button(view,'全选目录').props.onClick();find(view,n=>n.props['aria-label']==='选择章节：服务方式').props.onChange({target:{checked:false}});
  assert.equal(find(view,n=>n.props['aria-label']==='选择章节：售后方案').props.checked,false);assert.equal(find(view,n=>n.props['aria-label']==='选择章节：响应时间').props.checked,true);
  find(view,n=>n.props['aria-label']==='素材名称').props.onChange({target:{value:'响应服务'}});button(view,'保存所选素材').props.onClick();await view.settle();assert.deepEqual(writes[0].ranges,[[11,20]]);
 }finally{view.unmount();f.close()}
});

test('Word版式上传入口与其他栏目统一位于资料库标题右侧',async()=>{
 const f=await fixture(async url=>response(url.endsWith('/kb/types')?{types:[],field_labels:{}}:overview));const view=f.mount('Library');
 try{await view.settle();button(view,'Word版式').props.onClick();const upload=find(view,n=>n.type==='button'&&n.props.className==='primary');upload.props.onClick();const modal=find(view,n=>n.props.kind==='template');assert.equal(modal.props.kind,'template')}finally{view.unmount();f.close()}
});

test('文件传输100%仍等待服务器结果，进度来自实际传输事件',async()=>{
 const f=await fixture(async()=>response({})),events=[];let xhr;
 globalThis.XMLHttpRequest=class{upload={};constructor(){xhr=this}open(method,url){this.method=method;this.url=url}send(body){this.body=body}};
 try{
  let finished=false;const work=f.api.uploadFile('/materials/files',file('大方案.docx',1024),value=>events.push(value)).then(value=>{finished=true;return value});
  xhr.upload.onprogress({lengthComputable:true,loaded:256,total:1024});assert.deepEqual(events.at(-1),{loaded:256,total:1024,processing:false});
  xhr.upload.onload();await Promise.resolve();assert.equal(finished,false);assert.equal(events.at(-1).processing,true);
  xhr.status=201;xhr.response={id:'large'};xhr.onload();assert.deepEqual(await work,{id:'large'});assert.equal(xhr.url,'/api/bidv4/materials/files');
 }finally{f.close()}
});

test('服务器拒绝上传时保留明确错误，不把传输结束当作保存成功',async()=>{
 const f=await fixture(async()=>response({}));let xhr;globalThis.XMLHttpRequest=class{upload={};constructor(){xhr=this}open(){}send(){}};
 try{const work=f.api.uploadFile('/templates',file('超限.docx'),()=>{});xhr.upload.onload();xhr.status=413;xhr.response={detail:'版式文件超过 20MB 上限'};xhr.onload();await assert.rejects(work,error=>error.status===413&&error.message.includes('20MB'))}finally{f.close()}
});

test('写作素材超过100MB仍可选择并上传，其他类型的大小限制保留',async()=>{
 const calls=[];const f=await fixture(async(url,options)=>{calls.push([url,options]);return response({id:'large'})});const view=f.mount('Upload',{kind:'mt',overview,onClose(){},onDone(){}});
 try{choose(view,file('超大素材.docx',500*1024*1024));assert.equal(button(view,'上传并选择章节').props.disabled,false);assert.match(JSON.stringify(view.render()),/文件大小不限/);button(view,'上传并选择章节').props.onClick();await view.settle();assert.equal(calls[0][0],'/api/bidv4/materials/files')}finally{view.unmount();f.close()}
});
