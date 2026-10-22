import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const availability={usable:true,has_text:true,has_fields:false,source:'machine',label:'有识别内容·待人工核对'};
const item={id:'a',title:'原资料',file_name:'原件.docx',company_id:'c',revision:1,updated_at:'2026-10-19T10:00:00',parse_status:'ready',extract_status:'running',review_status:'processed',availability,business:{doc_type:'other',statement:'旧说明'},suggested:{},content:'旧正文',original_content:'旧正文',ocr:'旧正文',original_ocr:'旧正文',meta:{}};
const overview={companies:[{id:'c',name:'公司'}],types:[{code:'other',name:'其他'}],field_labels:{}};
const shared=()=>({overview,dirty:false,onDirty(){},onSaved(){},onError(){},epoch:0});
const page=items=>({items,total:items.length,page:1,pages:1,page_size:5});
const detail=view=>find(view,n=>n.props.item?.id==='a');
const button=(view,text)=>find(view,n=>n.type==='button'&&n.props.children===text);
async function timers(run){
 const prev={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};let seq=0;const jobs=new Map();
 globalThis.setTimeout=fn=>{jobs.set(++seq,fn);return seq};globalThis.clearTimeout=id=>jobs.delete(id);
 const tick=()=>{assert.equal(jobs.size,1);const [id,fn]=jobs.entries().next().value;jobs.delete(id);fn()};
 try{await run(tick,jobs)}finally{Object.assign(globalThis,prev)}
}
test('静默轮询不清空详情，不重复读取未改变的资料，也不进入列表加载态',()=>timers(async tick=>{
 let resolvePage;const calls=[];const f=await fixture(async url=>{calls.push(url);if(url.includes('?'))return calls.length===1?response(page([item])):new Promise(r=>resolvePage=r);return response(item)});
 const view=f.mount('Knowledge',shared());
 try{await view.settle();const before=detail(view);tick();await view.settle();assert.equal(detail(view).props.item,before.props.item);assert.equal(button(view,'检索资料').props.disabled,false);resolvePage(response(page([item])));await view.settle();assert.equal(detail(view).props.item,before.props.item);assert.equal(calls.filter(u=>u.endsWith('/a')).length,1)}finally{view.unmount();f.close()}
}));
test('识别完成时只更新相应资料，详情实例保持且轮询停止',()=>timers(async(tick,jobs)=>{
 let current=item;const f=await fixture(async url=>response(url.includes('?')?page([current]):current)),view=f.mount('Knowledge',shared());
 try{await view.settle();const before=detail(view);current={...item,extract_status:'done',updated_at:'2026-10-19T10:01:00',content:'新识别正文'};tick();await view.settle();const after=detail(view);assert.equal(after.props.item.ocr,'新识别正文');assert.equal(after.props.item.extract_status,'done');assert.equal(after.props.key,before.props.key);assert.equal(jobs.size,0)}finally{view.unmount();f.close()}
}));
test('另一份资料的识别进展不重新请求或替换当前详情',()=>timers(async tick=>{
 const current={...item,extract_status:'done'},other={...item,id:'b'};let rows=[current,other];const calls=[];
 const f=await fixture(async url=>{calls.push(url);return response(url.includes('?')?page(rows):current)}),view=f.mount('Knowledge',shared());
 try{await view.settle();const before=detail(view).props.item;rows=[current,{...other,extract_status:'done'}];tick();await view.settle();assert.equal(detail(view).props.item,before);assert.equal(calls.filter(u=>u.endsWith('/a')).length,1)}finally{view.unmount();f.close()}
}));
test('后台请求失败与切换资料时丢弃的旧回执均不清空当前详情',()=>timers(async tick=>{
 let resolvePoll,fail=false;const errors=[];const f=await fixture(async url=>{if(url.includes('?')){if(fail)throw Error('网络断开');return resolvePoll===null?new Promise(r=>resolvePoll=r):response(page([item,{...item,id:'b'}]))}return response({...item,id:url.split('/').at(-1)})});
 const view=f.mount('Knowledge',{...shared(),onError:e=>errors.push(e)});
 try{await view.settle();const before=detail(view).props.item;fail=true;tick();await view.settle();assert.equal(detail(view).props.item,before);assert.equal(errors.length,1);fail=false;resolvePoll=null;tick();await view.settle();find(view,n=>n.type==='button'&&n.props.className==='record ').props.onClick();await view.settle();resolvePoll(response(page([item])));await view.settle();assert.equal(nodes(view.render()).find(n=>n.props.item)?.props.item.id,'b')}finally{view.unmount();f.close()}
}));
test('新识别结果保持当前标签，未保存输入不被覆盖，取消后应用最新结果',async()=>{
 const f=await fixture(async()=>response({})),props={...shared(),item,onFileChanged(){}},view=f.mount('KnowledgeDetail',props);
 try{await view.settle();button(view,'识别全文').props.onClick();find(view,n=>n.props['aria-label']==='识别全文').props.onChange({target:{value:'我的未保存文字'}});props.item={...item,revision:2,extract_status:'done',ocr:'新的识别结果',business:{doc_type:'other',statement:'新说明'}};await view.settle();assert.equal(find(view,n=>n.props['aria-label']==='识别全文').props.value,'我的未保存文字');assert.equal(find(view,n=>n.type==='button'&&n.props.className==='primary').props.disabled,false);button(view,'取消修改').props.onClick();await view.settle();assert.equal(find(view,n=>n.props['aria-label']==='识别全文').props.value,'新的识别结果');assert.equal(button(view,'识别全文').props.className,'active')}finally{view.unmount();f.close()}
});
test('保存成功后接收完整新版本并清除草稿保护，详情不再依赖重挂载',async()=>{
 const saved={...item,revision:2,title:'已保存名称',extract_status:'done',review_status:'confirmed'};const marks=[];const f=await fixture(async()=>response(saved));const props={...shared(),item:{...item,extract_status:'done'},onFileChanged(){},onDirty:v=>marks.push(v)};const view=f.mount('KnowledgeDetail',props);
 try{await view.settle();find(view,n=>n.type==='input').props.onChange({target:{value:'已保存名称'}});await find(view,n=>n.props.className==='primary').props.onClick();await view.settle();assert.equal(find(view,n=>n.type==='input').props.value,'已保存名称');assert.equal(marks.at(-1),false);assert.equal(button(view,'取消修改').props.disabled,true)}finally{view.unmount();f.close()}
});
test('识别状态增加revision时保持原件URL，只有更换文件内容才刷新预览',async()=>{
 const f=await fixture(async()=>response({})),props={...shared(),item:{...item,file_hash:'original-hash'},onFileChanged(){}},view=f.mount('KnowledgeDetail',props);
 const source=()=>find(view,n=>n.props.url&&n.props.name).props.url;
 try{await view.settle();button(view,'原件对照').props.onClick();const before=source();props.item={...props.item,revision:2,extract_status:'done'};await view.settle();assert.equal(source(),before);props.item={...props.item,revision:3,file_hash:'replacement-hash'};await view.settle();assert.notEqual(source(),before)}finally{view.unmount();f.close()}
});
test('人工核对为空时显示AI已提取字段，采用后才写入表单且保留已有字段',async()=>{
 const extra={'账户名称':{value:'虚构星云测试公司',source:'第1页'},'账号':{value:'0000123400005678',source:'第1页'},'开户银行':{value:'虚构示例银行测试支行',source:'第1页'}};
 const f=await fixture(async()=>response({})),props={...shared(),item:{...item,extract_status:'done',review_status:'confirmed',business:{doc_type:'other',fields:{},extra:{'账户名称':{value:'人工核对名称',source:'人工'}}},suggested:{doc_type:'other',extra}},onFileChanged(){}},view=f.mount('KnowledgeDetail',props);
 try{await view.settle();assert.ok(nodes(view.render()).some(n=>n.type==='dt'&&n.props.children==='账号'));assert.equal(nodes(view.render()).filter(n=>n.type==='input'&&n.props['aria-label']?.startsWith('字段值')).length,1);button(view,'采用这些识别字段').props.onClick();await view.settle();assert.equal(find(view,n=>n.props['aria-label']==='字段值 账号').props.value,'0000123400005678');assert.equal(find(view,n=>n.props['aria-label']==='字段值 账户名称').props.value,'人工核对名称');assert.equal(button(view,'取消修改').props.disabled,false)}finally{view.unmount();f.close()}
});
test('已保存的新revision不被延迟的旧识别回执倒退覆盖',async()=>{
 const saved={...item,title:'最新保存',revision:5,extract_status:'done'};
 const f=await fixture(async()=>response(saved)),props={...shared(),item:{...item,extract_status:'done'},onFileChanged(){}},view=f.mount('KnowledgeDetail',props);
 try{await view.settle();find(view,n=>n.type==='input').props.onChange({target:{value:'最新保存'}});await find(view,n=>n.props.className==='primary').props.onClick();await view.settle();props.item={...item,title:'迟到的识别版本',revision:2,extract_status:'done'};await view.settle();assert.equal(find(view,n=>n.type==='input').props.value,'最新保存')}finally{view.unmount();f.close()}
});
