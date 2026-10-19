import test from 'node:test';
import assert from 'node:assert/strict';
import {Context,symbols} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Llm,{LlmAdapter} from '@deepseek-ai/dsh-llm';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import {mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createBusinessScope} from './helpers/runtime-host.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {business,dataRoot} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const requests=[];let childStarted,childSignal,hostScope;
class Adapter extends LlmAdapter{
 providerInfo(id){return {id,name:'Deterministic engineering fixture'}}
 async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384,inputModalities:['text','image']}}
 async *stream(options){
  requests.push(options);
  for(const image of options.messages.flatMap(m=>m.content).filter(b=>b.type==='image'))assert.ok((await hostScope.ctx.attachments.readImage(image.attachment)).data.length);
  const last=options.messages.findLast(m=>m.role==='tool'||['human','user','user-question-reply'].includes(m.source?.kind));const pendingReply=last?.source?.kind==='user-question-reply';
  const prompt=last?.content?.filter(b=>b.type==='text').map(b=>b.text).join('')??'';
  if(prompt.includes('native-cancel-child-fixture')){childSignal=options.signal;childStarted();await new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})});return}
  if(prompt.includes('native-outline-first-write-fixture')&&last?.role!=='tool'){
   const contract=JSON.parse(prompt.match(/本轮目录依据与原结构约束：([^\n]+)/)[1]);
   const content='# 响应文件：工程册\n本册仅验证运行接线。\n\n## 目录\n- 工程目录\n\n首步写入已验证。\n';
   const calls=[{id:'outline-fragment-write',path:contract.fragment_path,content},{id:'outline-other-denied',path:join(dirname(contract.fragment_path),'越权册.md'),content:'越权内容不得写入'},{id:'outline-combined-denied',path:join(dirname(dirname(contract.fragment_path)),'tender-response-docs.md'),content:'越权内容不得写入'}];
   for(const [index,call]of calls.entries()){const block={type:'tool-call',id:call.id,name:'write',arguments:JSON.stringify({file_path:call.path,content:call.content})};yield {type:'block-start',index,blockType:block.type};yield {type:'block-end',index,block}}
   yield {type:'finish',reason:{kind:'tool-calls'}};return;
  }
  let block;
  if(prompt.includes('native-cancel-fixture'))block={type:'tool-call',id:'cancel-child',name:'task',arguments:JSON.stringify({subagent_type:'tender-outline-writer',response_file:'工程册',description:'native-cancel-child-fixture'})};
  else if(last?.role==='tool'||pendingReply)block={type:'text',text:last?.content.some(b=>b.type==='image')?'本页为工程识别通路验证，验证文件已交由同一模型的官方子Agent读取图片。'.repeat(8):'工程调用已返回'};
  else{const text=last?.content?.filter(b=>b.type==='text').map(b=>b.text).join('')??'';block=options.messages.some(m=>m.role==='system'&&m.content.some(b=>b.type==='text'&&b.text.includes('你是投标资料管理员')))?{type:'text',text:JSON.stringify({doc_type:'company_profile',statement:'本资料记录工程验证信息与公司介绍，仅验证整理入库与检索的接线情况。',questions:['公司介绍在哪里'],fields:{},extra:{}})}:text.includes('调用read_image读取图片：')?{type:'tool-call',id:'image-call',name:'read_image',arguments:JSON.stringify({file_path:text.match(/调用read_image读取图片：(.*?)。/)[1]})}:text.includes('native-ocr-fixture')?{type:'tool-call',id:'ocr-call',name:'parse_document',arguments:JSON.stringify({file_name:'工程源.png'})}:text.includes('native-question-fixture')?{type:'tool-call',id:'question-call',name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'service',question:'服务期限是多少？',options:[{label:'三年'},{label:'五年'}]}]})}:text.includes('native-subagent-fixture')?{type:'tool-call',id:'child-call',name:'task',arguments:JSON.stringify({subagent_type:'tender-outline-writer',response_file:'工程册',description:'native-outline-first-write-fixture'})}:text.includes('native-parse-fixture')?{type:'tool-call',id:'parse-call',name:'parse_document',arguments:JSON.stringify({file_name:'工程源.docx'})}:{type:'text',text:'原目录角色就绪'};}
  yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
 }
}
async function waitServices(ctx,names){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Services unavailable: '+names.filter(n=>!ctx.get(n)).join(','))),8000);ctx.inject(names,c=>{clearTimeout(timer);resolve(c)})})}
if(process.env.BIDV4_NATIVE_FIXTURE==='1')test('正式预设与官方dsh会话、子Agent、页面具体问题协议及冷恢复', {timeout:40000},async()=>{
 const host=new Context();host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,{provider:'fixture',model:'configured-model'});await waitServices(host,['llm','subprocess','agentDefaultModel','loader']);host.llm.registerAdapter(['fixture'],new Adapter());
 await host.plugin(Attachments,{dshHome:join(dataRoot,'fixture-host')});await waitServices(host,['attachments']);
 hostScope=await createBusinessScope(host,join(dataRoot,'fixture-host'));
 await hostScope.ctx.plugin(SessionTitle,{fallbackMaxWords:8,fallbackMaxBytes:100,maxTitleBytes:200});
 let hostLeaks=0,businessLeaksAtShutdown;
 for(const event of ['agent/pre-step','agent/request','tools/execute','session/created','session/event','session/flush','subagent/start','subagent/end','user-questions/request','llm/stream'])hostScope.ctx.on(event,(_payload,next)=>{hostLeaks++;return typeof next==='function'?next():undefined},{global:true});
 const tid='t_'+randomUUID().replaceAll('-',''),scopeRoot=join(dataRoot,'.validation',tid);let scope,runtime,knowledgeId;
 try{
  scope=await createBusinessScope(hostScope.ctx,scopeRoot);runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});
  assert.notEqual(scope.ctx.events,hostScope.ctx.events);
  assert.equal(scope.ctx.llm[symbols.original],host.llm[symbols.original]);assert.equal(scope.ctx.attachments[symbols.original],host.attachments[symbols.original]);
  const roster=await scope.ctx.agentPresets.list();assert.ok(roster.find(r=>r.id==='ooo-bidpliot'&&!r.broken),JSON.stringify(roster));
  const task=await business(scope.ctx,'create_task',{title:'一次性工程验证',request_id:tid.slice(2)});assert.equal(task.task.id,tid);await runtime.skillsLink(join(dataRoot,'workspace',tid));
  const id='native-'+randomUUID();const h=await scope.ctx.agents.create({sessionId:id,meta:{cwd:join(dataRoot,'workspace',tid),agentPreset:'ooo-bidpliot'},agentOptions:await runtime.select(),setup:async c=>{await scope.ctx.agentPresets.mount(c,'ooo-bidpliot')}});runtime.handles.set(id,h);
  const work=join(dataRoot,'workspace',tid,'work');
  for(const name of ['requirements-format.md','requirements-business.md','evaluation.md'])await writeFile(join(work,'analysis',name),'本工程夹具无业务要求。');
  const engineeringOutline='# 响应文件：工程册\n本册仅验证运行接线。\n\n## 目录\n- 工程目录\n';
  await mkdir(join(work,'outline/fragments'),{recursive:true});
  await writeFile(join(work,'outline/tender-response-docs.md'),engineeringOutline);await writeFile(join(work,'outline/fragments/工程册.md'),engineeringOutline);
  await business(scope.ctx,'outline_begin',{task_id:tid,action_id:'engineering-outline'});
  assert.equal((await business(scope.ctx,'tool',{name:'outline_plan',parameters:{operation:'complete',volume:'工程册',root_titles:'工程目录'}},{taskId:tid,sessionId:id,callId:'engineering-plan'})).ok,true);
  const outlineAction={action_id:'engineering-outline',start_seq:0,kind:'outline',session_id:id,task_id:tid,model:{provider:'fixture',model:'configured-model'}};await mkdir(join(dataRoot,'actions',tid),{recursive:true});await writeFile(join(dataRoot,'actions',tid,'latest.json'),JSON.stringify(outlineAction));
  h.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'native-subagent-fixture'}]}));await h.agent.whenIdle();await scope.ctx.sessions.flush(h.agent.session);
  assert.equal(h.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed');assert.ok(requests.length>=3,JSON.stringify({requests:requests.map(o=>({last:o.messages.findLast(m=>m.role==='tool'||['human','user','user-question-reply'].includes(m.source?.kind)),tools:o.tools?.map(t=>t.name)})),events:h.agent.session.snapshotEvents().filter(e=>e.type==='tool/result')}));assert.ok(requests[0].tools.some(t=>t.name==='read_image'));assert.ok(requests.every(o=>o.provider==='fixture'&&o.model==='configured-model'));
  const outlineChild=(await scope.ctx.subagents.listChildren(id))[0];assert.ok(outlineChild);const childObservation=await scope.ctx.sessionQuery.observeSession(outlineChild.id,{projectionMode:'none'});
  try{const events=childObservation.events;assert.equal(events.find(e=>e.type==='tool/call').data.callId,'outline-fragment-write','The very first child step must write its assigned fragment');const result=callId=>events.find(e=>e.type==='tool/result'&&e.data.message.toolCallId===callId).data.message;assert.equal(result('outline-fragment-write').isError,false);for(const callId of ['outline-other-denied','outline-combined-denied']){assert.equal(result(callId).isError,true);assert.match(JSON.stringify(result(callId)),/目录子代理只允许写入本册指定fragment/)}}finally{childObservation[Symbol.dispose]()}
  assert.match(await readFile(join(work,'outline/fragments/工程册.md'),'utf8'),/首步写入已验证/);await assert.rejects(readFile(join(work,'outline/fragments/越权册.md')),{code:'ENOENT'});assert.equal(await readFile(join(work,'outline/tender-response-docs.md'),'utf8'),engineeringOutline);
  await rm(join(dataRoot,'actions',tid,'latest.json'));await runtime.applyStageTools(h.agent,'analyse');
  await writeFile(join(dataRoot,'workspace',tid,'sources','工程源.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64'));
  h.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'native-ocr-fixture'}]}));await h.agent.whenIdle();
  const parsed=await readFile(join(dataRoot,'workspace',tid,'work/parse/工程源.png/工程源.png.meta.json'),'utf8');assert.equal(JSON.parse(parsed).conversion,'vision');
  assert.ok((await readdir(hostScope.ctx.attachments.root,{recursive:true})).length);
  const company=await business(scope.ctx,'route',{method:'POST',path:'/library/companies',body:{name:'工程公司'}});
  const kb=await business(scope.ctx,'route',{method:'POST',path:'/kb/files',query:{company_id:company.id},upload:{path:join(dataRoot,'workspace',tid,'sources','工程源.png'),filename:'工程入库-'+tid+'.png'}});knowledgeId=kb.id;await runtime.ingestKnowledge(kb.id);const kbState=await business(scope.ctx,'route',{method:'GET',path:'/kb/items/'+kb.id});assert.equal(kbState.parse_status,'ready');assert.equal(kbState.extract_status,'done');assert.equal(kbState.review_status,'processed');assert.ok(requests.every(o=>o.provider==='fixture'&&o.model==='configured-model'));
  const replaced=await business(scope.ctx,'route',{method:'POST',path:'/kb/items/'+kb.id+'/replace',query:{revision:kbState.revision},upload:{path:join(dataRoot,'workspace',tid,'sources','工程源.png'),filename:'工程更换-'+tid+'.png'}});
  assert.equal(replaced.id,kb.id);await runtime.ingestKnowledge(kb.id);
  const replacedState=await business(scope.ctx,'route',{method:'GET',path:'/kb/items/'+kb.id});assert.equal(replacedState.file_name,replaced.file_name);assert.equal(replacedState.extract_status,'done');assert.equal(replacedState.company_id,company.id);assert.ok(replacedState.revision>kbState.revision);assert.equal(replacedState.review_status,'processed');
  // Digital parsing must commit even when no model can be selected.
  const sourceDoc='body/虚构数字资料.docx';
  const made=await business(scope.ctx,'tool',{name:'docx_section_create',parameters:{path:sourceDoc,title:'虚构数字资料',paragraphs:'虚构公司的有效数字正文，模型不可用也不能撤销本地解析。'}},{taskId:tid});assert.match(made,/已创建/);
  const digital=await business(scope.ctx,'route',{method:'POST',path:'/kb/files',query:{company_id:company.id},upload:{path:join(dataRoot,'workspace',tid,'work',sourceDoc),filename:'虚构数字资料.docx'}});
  const select=runtime.select;runtime.select=async()=>{throw new Error('虚构模型配置不可用')};
  try{await runtime.ingestKnowledge(digital.id)}finally{runtime.select=select}
  const digitalState=await business(scope.ctx,'route',{method:'GET',path:'/kb/items/'+digital.id});
  assert.equal(digitalState.parse_status,'ready');assert.equal(digitalState.extract_status,'failed');assert.match(digitalState.content,/有效数字正文/);assert.match(digitalState.error,/模型配置不可用/);
  const questionStart=h.agent.session.snapshotEvents().length;
  h.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'native-question-fixture'}]}));await h.agent.whenIdle();await scope.ctx.sessions.flush(h.agent.session);
  const record={action_id:'probe',start_seq:questionStart,created_at:Date.now(),task_id:tid,session_id:id,kind:'probe',model:{provider:'fixture',model:'configured-model'}};await mkdir(join(dataRoot,'actions',tid),{recursive:true});await writeFile(join(dataRoot,'actions',tid,'latest.json'),JSON.stringify(record));await writeFile(join(dataRoot,'actions',tid,'probe.json'),JSON.stringify(record));
  let state=await runtime.state(tid);assert.equal(state.execution.state,'needs_input');assert.equal(state.execution.questions[0].callId,'question-call');
  await assert.rejects(runtime.answer(tid,id,{call_ids:['question-call'],batches:[{call_id:'question-call',answers:[]}]}),/问题与回答不一致/);
  await business(scope.ctx,'route',{method:'POST',path:'/kb/items/'+knowledgeId+'/retrigger',query:{revision:(await business(scope.ctx,'route',{method:'GET',path:'/kb/items/'+knowledgeId})).revision}});await writeFile(join(dataRoot,'knowledge-jobs',knowledgeId+'.json'),JSON.stringify({id:knowledgeId,pid:2147483647}));
  await runtime.close();await scope.close();scope=await createBusinessScope(hostScope.ctx,scopeRoot);runtime=new BusinessRuntime(scope.ctx);await runtime.init();scope.ctx.reflect.provide('bidBusiness',runtime);scope.ctx.reflect.provide('webServer',{port:0});state=await runtime.state(tid);assert.equal(state.execution.state,'needs_input');
  const recoveredKb=await business(scope.ctx,'route',{method:'GET',path:'/kb/items/'+knowledgeId});assert.equal(recoveredKb.parse_status,'failed');assert.equal(recoveredKb.extract_status,'pending');assert.match(recoveredKb.error,/中断/);
  await runtime.answer(tid,id,{call_ids:['question-call'],batches:[{call_id:'question-call',answers:[{id:'service',selected:['三年']}]}]});await runtime.handles.get(id).agent.whenIdle();assert.equal((await runtime.state(tid)).execution.state,'completed');assert.ok(runtime.handles.get(id).agent.session.snapshotEvents().some(e=>e.type==='user/message'&&e.data.source?.kind==='user-question-reply'));
  const started=new Promise(resolve=>{childStarted=resolve});runtime.handles.get(id).agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'native-cancel-fixture'}]}));await started;
  await runtime.stop(tid,id);assert.equal(childSignal.aborted,true);assert.equal((await runtime.state(tid)).execution.state,'stopped');
  const analysisPath=join(dataRoot,'workspace',tid,'work/analysis/structure.md');await writeFile(analysisPath,'工程旧解读');
  const first=await runtime.state(tid);assert.equal(first.analysis_progress.find(p=>p.key==='basic').done,1);
  const payload={kind:'analyse',request_id:randomUUID(),input_version:first.input_versions.analyse,main_file:'工程源.png',supplements:[]};const admitted=await runtime.action(tid,payload);await runtime.handles.get(admitted.session_id).agent.whenIdle();await runtime.settling.get(tid);assert.equal((await runtime.state(tid)).execution.state,'failed');assert.match((await runtime.state(tid)).execution.error,/未产出所需文件/);
  assert.equal((await runtime.state(tid)).analysis_progress.find(p=>p.key==='basic').done,0,'旧解读不计入本轮');
  await writeFile(analysisPath,'工程旧解读');assert.equal((await runtime.state(tid)).analysis_progress.find(p=>p.key==='basic').done,0,'结束后的人工写入不计为本轮产出');
  assert.deepEqual(await runtime.action(tid,payload),{session_id:admitted.session_id,action_id:admitted.action_id,replayed:true});await assert.rejects(runtime.action(tid,{...payload,main_file:'other.png'}),/同一请求/);const stateNow=await runtime.state(tid);await assert.rejects(runtime.action(tid,{kind:'outline',request_id:randomUUID(),input_version:stateNow.input_versions.outline}),/八份招标解读/);
  const logs=await readdir(join(scopeRoot,'sessions'),{recursive:true});assert.ok(logs.some(p=>p.endsWith('.jsonl')));
  const closingChild=new Promise(resolve=>{childStarted=resolve});runtime.handles.get(id).agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'native-cancel-fixture'}]}));await closingChild;await runtime.close();assert.equal(childSignal.aborted,true);businessLeaksAtShutdown=hostLeaks;
  const hostProbe=await hostScope.ctx.agents.create({sessionId:'host-after-business-close',meta:{cwd:scopeRoot},agentOptions:{provider:'fixture',model:'configured-model'}});
  try{hostProbe.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'host remains usable'}]}));await hostProbe.agent.whenIdle();assert.equal(hostProbe.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed')}finally{await hostProbe.dispose()}
 }finally{if(scope&&knowledgeId)await business(scope.ctx,'route',{method:'DELETE',path:'/kb/items/'+knowledgeId}).catch(()=>{});if(scope)await business(scope.ctx,'archive_task',{task_id:tid}).catch(()=>{});await runtime?.close();await scope?.close();assert.equal(businessLeaksAtShutdown??hostLeaks,0,'business events reached the host');await hostScope.close();await host.fiber.dispose();await rm(scopeRoot,{recursive:true,force:true});await rm(join(dataRoot,'actions',tid),{recursive:true,force:true});await rm(join(dataRoot,'locks',tid),{force:true});await rm(join(dataRoot,'tool-receipts',tid),{recursive:true,force:true});await rm(join(dataRoot,'workspace/archive',tid),{recursive:true,force:true})}
});
else test('业务原生链路只使用临时数据库与文件', {timeout:60000},()=>runIsolatedTest('native-runtime.test.mjs','BIDV4_NATIVE_FIXTURE',/正式预设与官方dsh会话、子Agent、页面具体问题协议及冷恢复/,50000));
