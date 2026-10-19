import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
const item={id:'k',revision:1,title:'虚构营业执照',file_name:'虚构执照.png',company_id:'co',business:{doc_type:'other'},suggested:{},ocr:'',original_ocr:'',meta:{},parse_status:'failed',extract_status:'pending',error:'虚构旧JSON错误',review_status:'confirmed',availability:{usable:false,has_text:false,has_fields:false,source:'raw',label:'仅原件可定位·无可用事实内容'}};
const overview={companies:[{id:'co',name:'虚构公司'}],types:[{code:'other',name:'其他'}],field_labels:{}};
for(const usable of [false,true])test(`人工核对后的可用能力与机器错误分开呈现：usable=${usable}`,async()=>{
 const updated={...item,availability:usable?{...item.availability,usable:true,source:'human',label:'有人工核对内容'}:item.availability};
 const saves=[];const f=await fixture(async()=>response(updated)),view=f.mount('KnowledgeDetail',{item:updated,overview,onDirty(){},onSaved:m=>saves.push(m),onError:e=>{throw e}});
 try{
  const inline=nodes(view.render()).filter(n=>n.props.className?.includes('inline-note')).map(text).join('');
  assert.equal(inline.includes('虚构旧JSON错误'),!usable);
  assert.match(text(find(view,n=>n.type==='details')),/机器处理记录：虚构旧JSON错误/);
  await find(view,n=>n.type==='button'&&n.props.children==='保存并核对').props.onClick();await view.settle();
  assert.match(saves[0],usable?/实际内容已加入检索/:/尚无可用事实内容/);
 }finally{view.unmount();f.close()}
});

test('writing material reparse refreshes outer file state without closing the chapter picker',async()=>{
 let parsed=false;
 const f=await fixture(async url=>{
  const file={id:'f',file_name:'虚构素材.docx',parse_status:parsed?'ready':'failed',error:parsed?null:'旧解析错误',block_count:0};
  return response(url.endsWith('/files')?{files:[file]}:{items:[{...file,kind:'file'}],total:1,page:1,pages:1,page_size:5});
 });
 const props={overview,dirty:false,onDirty(){},onError:e=>{throw e},epoch:0,onSaved:async()=>{props.epoch++}},view=f.mount('Materials',props);
 try{
  await view.settle();find(view,n=>n.type==='button'&&n.props.children==='查看并重试').props.onClick();await view.settle();
  const picker=find(view,n=>n.props.fid==='f');parsed=true;await picker.props.onSourceChanged();await view.settle();
  assert.doesNotMatch(text(view.render()),/旧解析错误|解析失败/);
  assert.match(text(view.render()),/待选章节/);
  assert.equal(find(view,n=>n.props.label==='从文件建立素材').props.open,true);
 }finally{view.unmount();f.close()}
});

test('successful material parsing replaces old failure while retaining a current range warning',async()=>{
 let reparsed=false,notified=0;
 const f=await fixture(async(_url,options={})=>{if(options.method){reparsed=true;return response({ok:true})}return response(reparsed?{parse_status:'ready',error:'已保存区间发生变化，请复核',outline:[{标题:'虚构售后',start_line:1,end_line:2}]}:{parse_status:'failed',error:'旧JSON失败',outline:[]})},{realMaterialBlocks:true});
 const view=f.mount('MaterialBlocks',{fid:'f',onReparsed:async()=>{notified++},onChanged:async()=>{}});
 try{
  await view.settle();find(view,n=>n.type==='button'&&n.props.children==='重新解析').props.onClick();await view.settle();
  assert.equal(notified,1);assert.doesNotMatch(text(view.render()),/旧JSON失败/);assert.match(text(view.render()),/区间发生变化/);
 }finally{view.unmount();f.close()}
});
