import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,find,response} from './helpers/component-fixture.mjs';

const selection={volume:'技术册',title:'实施方案'};
const initial=()=>({task:{id:'t',title:'同步验收'},execution:null,analysis_progress:[],files:[],directory:{artifact_id:'d',content_seq:1,content:{response_documents:[]}},source_selection:{main:'原件.docx',supplements:[],excluded:[]},body_files:['body/实施方案.docx','body/保留章节.docx'],body_sections:[{...selection,path:'body/实施方案.docx',status:'ready'},{volume:'技术册',title:'保留章节',path:'body/保留章节.docx',status:'ready'}],build_preparation:{guide:'ready',promises:'ready'},volume_states:[],input_versions:{body:'b1',revise:'r1'}});

for(const kind of ['body','revise'])test(kind+'提交成功但首次刷新失败时持续同步，完成后解除禁用并更新正文版本',async()=>{
 const savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval,timers=new Map();let timerId=0;
 globalThis.setInterval=fn=>{timers.set(++timerId,fn);return timerId};globalThis.clearInterval=id=>timers.delete(id);
 let state=initial(),failRead=false,posts=0;
 const f=await fixture(async(url,options={})=>{
  if(url.endsWith('/action')){posts++;state={...state,execution:{session_id:'s',action_id:'a',kind,state:'running',sections:[selection],questions:[]}};failRead=true;return response({session_id:'s',action_id:'a'})}
  if(url.includes('/page-flow/')){if(failRead){failRead=false;return response({detail:'暂时不可读取'},503)}return response(state)}
  return response({files:[],artifacts:[]});
 });
 const view=f.mount('ProjectWorkbench',{tid:'t',mode:'build',onBack(){},onMode(){}}),props=()=>find(view,n=>n.props?.flow&&n.props.execute).props;
 try{
  await view.settle();assert.equal(await props().execute(kind,[selection],{instruction:'仅处理本章'}),true);await view.settle();
  assert.equal(props().syncing,true);assert.equal(props().disabled,true);assert.equal(timers.size,1,'首次刷新失败不能停止状态同步');
  await [...timers.values()][0]();await view.settle();assert.equal(props().flow.execution.state,'running');assert.equal(props().syncing,false);assert.equal(props().disabled,true);assert.equal(await props().execute(kind,[selection],{instruction:'不应重复提交'}),false);assert.equal(posts,1);
  state={...state,execution:{...state.execution,state:'completed'},input_versions:{body:'b1',revise:'r2'},volume_states:[{name:'技术册',status:'stale'}]};
  await [...timers.values()][0]();await view.settle();
  assert.equal(props().flow.execution.state,'completed');assert.equal(props().disabled,false);assert.equal(props().flow.input_versions.revise,'r2');assert.equal(props().flow.volume_states[0].status,'stale');assert.equal(posts,1);assert.equal(timers.size,0);
 }finally{view.unmount();f.close();globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear}
});

test('提交回执丢失后自动读取真实执行，新一次同要求修改不能重放上一轮请求',async()=>{
 let state=initial(),loseReply=true;const payloads=[];
 const f=await fixture(async(url,options={})=>{
  if(url.endsWith('/action')){const p=JSON.parse(options.body);payloads.push(p);state={...state,execution:{session_id:'s',action_id:createHash('sha256').update(p.request_id).digest('hex'),kind:p.kind,state:'completed',created_at:Date.now()+1,sections:p.sections,questions:[]}};if(loseReply){loseReply=false;throw Error('Failed to fetch')}return response({session_id:'s',action_id:state.execution.action_id})}
  if(url.includes('/page-flow/'))return response(state);
  return response({files:[],artifacts:[]});
 });
 const view=f.mount('ProjectWorkbench',{tid:'t',mode:'build',onBack(){},onMode(){}}),props=()=>find(view,n=>n.props?.flow&&n.props.execute).props;
 try{
  await view.settle();assert.equal(await props().execute('revise',[selection],{instruction:'改得简洁'}),false);await view.settle();
  assert.equal(props().flow.execution?.state,'completed','回执丢失后应主动对账');
  await props().execute('revise',[selection],{instruction:'改得简洁'});await view.settle();
  assert.equal(payloads.length,2);assert.notEqual(payloads[0].request_id,payloads[1].request_id,'用户发起新一轮修改必须生成新请求');
 }finally{view.unmount();f.close()}
});
