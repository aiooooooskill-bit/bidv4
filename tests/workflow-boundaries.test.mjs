import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,find,response} from './helpers/component-fixture.mjs';
import {projectStatus} from '../server/native/chat-tools.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {transcribe} from '../server/native/tools.mjs';
import {presetDefinition} from '../server/native/preset.mjs';
const state=()=>({task:{id:'t1',title:'边界验收'},execution:null,analysis_progress:[],files:[],directory:null,bidder:{confirmed:true,stale:false},source_selection:{main:'招标.docx',supplements:[],excluded:[]},body_files:[],body_sections:[],input_versions:{analyse:'v1'},workflow:{id:'workflow-1',state:'completed',completed:['analyse','outline','build','review']},volume_states:[{name:'技术标',artifact_id:'volume-1',status:'ready'}],review:{status:'unreviewed',input_version:'r1',report:null}});

test('有未保存修改时自动完成不发请求，保存后可启动，停止仍校验流程身份',async()=>{
 const requests=[],f=await fixture(async(url,options)=>{if(url.endsWith('/workflow-plan'))return response({input_versions:{analyse:'v1'},steps:[{kind:'analyse',reusable:true},{kind:'outline',reusable:false},{kind:'build',reusable:false}]});requests.push({url,method:options.method,body:JSON.parse(options.body)});return response({ok:true})});
 const guard=f.mount('NavigationGuard',{children:null});guard.render();
 const dirty=value=>{f.api.useNavigationGuard().mark('guide-editor',value);guard.render()};
 const flow=state(),control=f.mount('WorkflowControls',{tid:'t1',flow,onChanged:async()=>{}});
 try{
  dirty(true);let button=find(control,n=>n.type==='button');assert.equal(button.props.disabled,true);assert.match(button.props.title,/先保存/);
  button.props.onClick();await control.settle();assert.equal(requests.length,0,'A stale handler must also refuse unsaved input');
  dirty(false);button=find(control,n=>n.type==='button');assert.equal(button.props.disabled,false);button.props.onClick();await control.settle();assert.equal(requests.length,0);find(control,n=>n.type==='button'&&n.props.children==='开始自动完成').props.onClick();await control.settle();assert.equal(requests[0].method,'POST');assert.equal(requests[0].body.include_review,false);
  flow.workflow.state='running';dirty(true);button=find(control,n=>n.type==='button');assert.equal(button.props.children,'停止流程');assert.equal(button.props.disabled,false);button.props.onClick();await control.settle();assert.deepEqual(requests[1].body,{workflow_id:'workflow-1'});assert.equal(requests[1].method,'DELETE');
 }finally{control.unmount();guard.unmount();f.close()}
});

test('章节变更使整册过期后，页面及Agent均不把旧版列为当前下载，重新合册后恢复',async()=>{
 const flow=state(),artifacts=[{artifact_id:'volume-1',kind:'tender.volume',display_name:'技术标'},{artifact_id:'old-volume',kind:'tender.volume',display_name:'历史册'}];
 const f=await fixture(async url=>response(url.includes('/page-flow/')?flow:{files:[],artifacts}));
 const view=f.mount('ProjectWorkbench',{tid:'t1',mode:'analysis',onBack(){},onMode(){}});
 const ctx={bidBusiness:{state:async()=>flow,artifacts:async()=>({artifacts})}};
 const downloads=()=>nodes(view.render()).filter(n=>n.type==='a'&&n.props.download);
 try{
  await view.settle();assert.equal(downloads().length,1);assert.equal((await projectStatus(ctx,'t1',x=>x)).outputs.length,1);
  flow.volume_states[0].status='stale';window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.equal(downloads().length,0);assert.deepEqual((await projectStatus(ctx,'t1',x=>x)).outputs,[]);
  flow.volume_states[0].status='ready';window.dispatchEvent(new Event('ooo-bidpliot:changed'));await view.settle();assert.equal(downloads().length,1);assert.equal((await projectStatus(ctx,'t1',x=>x)).outputs.length,1);
 }finally{view.unmount();f.close()}
});

test('模型选择按原生待选、已执行和新会话状态读取，审查预算采用同一模型信息',async()=>{
 let pending=null,header;const resolved=[];
 const runtime=new BusinessRuntime({sessionProjections:{stateOf:()=>({pending})},agentDefaultModel:{currentSelection:()=>({provider:'default',model:'default-model'})},llm:{resolveModelInfo:async(provider,model)=>{resolved.push({provider,model});return {context:{contextWindow:16384},defaultMaxTokens:8192}}}});
 const agent={options:{provider:'initial',model:'initial-model'},session:{requestHeader:()=>header}};
 assert.equal(runtime.modelSelection(agent).model,'initial-model');
 header={config:{provider:'session',model:'used-model',reasoningEffort:'high'},adapterDefaults:{reasoningEffort:true}};
 assert.equal(runtime.modelSelection(agent).model,'used-model');assert.equal(runtime.modelSelection(agent).reasoningEffort,undefined);
 pending={provider:'session',model:'next-model',reasoningEffort:'low'};
 const selected=await runtime.select('review',runtime.modelSelection(agent));
 assert.deepEqual(resolved,[{provider:'session',model:'next-model'}]);assert.equal(selected.model,'next-model');assert.equal(selected.reasoningEffort,'low');assert.equal(selected.maxTokens,4096);
});

test('保留用户已确认的DSH预设展示描述',()=>{
 assert.equal(presetDefinition.description,'页面操作，dsh运行业务，Agent展示真实进度与文档');
});

test('图片解析能力检查使用原生会话实际模型，不使用创建时的旧模型',async()=>{
 const checked=[],ctx={llm:{resolveModelInfo:async(provider,model)=>{checked.push({provider,model});return {inputModalities:['text']}}}};
 const agent={options:{provider:'old-provider',model:'old-model'},session:{requestHeader:()=>({config:{provider:'current-provider',model:'current-model'}})}};
 await assert.rejects(transcribe(ctx,{needs_ocr:true},{agent,signal:AbortSignal.timeout(1000)}),/未声明图片输入能力/);
 assert.deepEqual(checked,[{provider:'current-provider',model:'current-model'}]);
});
