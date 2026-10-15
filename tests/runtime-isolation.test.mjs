import test from 'node:test';
import assert from 'node:assert/strict';
import {Context,symbols} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createBusinessScope} from './helpers/runtime-host.mjs';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {subagentFailure} from '../server/native/tools.mjs';
import {inject} from '../server/plugin.mjs';

const message=text=>createUserMessage({source:{kind:'human'},content:[{type:'text',text}]});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64');
const model={provider:'fixture',model:'configured-model'};
const terminal=agent=>agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason;
class Fixture extends LlmAdapter{
 calls=[];
 providerInfo(id){return {id,name:'Runtime regression fixture'}}
 async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384,inputModalities:['text','image']}}
 async *stream(options){
  this.calls.push(options);
  const last=options.messages.findLast(m=>m.role==='tool'||m.role==='user');
  if(last?.content.some(b=>b.type==='text'&&b.text==='CLOSE_CHILD')){this.childSignal=options.signal;this.childStarted.resolve();await new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})});return}
  const tool=last?.role!=='tool'&&last?.content.some(b=>b.type==='text'&&['TOOL_BOUNDARY','CLOSE_PARENT'].includes(b.text));
  const block=tool?{type:'tool-call',id:'probe-call',name:'probe',arguments:'{}'}:{type:'text',text:'fixture completed'};
  yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:tool?'tool-calls':'stop'}};
 }
}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'bidv4-isolation-test-')),host=new Context();let scope;
 try{
  host.plugin(Loader,{baseUrl:new URL('../package.json',import.meta.url).href});host.plugin(Llm);host.plugin(Subprocess);host.plugin(DefaultModel,model);host.plugin(Attachments,{dshHome:join(dir,'host')});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Host initialization timed out')),8000);host.inject(['llm','subprocess','agentDefaultModel','attachments','loader'],()=>{clearTimeout(timer);resolve()})});
  const adapter=new Fixture();host.llm.registerAdapter(['fixture'],adapter);
  const hostRuntime=await createBusinessScope(host,join(dir,'host'));
  scope=await createBusinessScope(hostRuntime.ctx,join(dir,'business'));
  const handles=[];
  return {dir,host,hostRuntime,scope,adapter,handles,async agent(ctx,id,setup){const h=await ctx.agents.create({sessionId:id,meta:{cwd:dir},agentOptions:model,setup});handles.push(h);return h.agent},async close(){for(const h of handles)await h.dispose();await scope.close();await hostRuntime.close();await host.fiber.dispose();await rm(dir,{recursive:true,force:true})}};
 }catch(error){await scope?.close();await host.fiber.dispose();await rm(dir,{recursive:true,force:true});throw error}
}

test('官方scope包完整且插件与配置都声明宿主附件依赖',async()=>{
 const source=await readFile(new URL('../node_modules/@deepseek-ai/dsh-scope/lib/index.js',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),'2829df71d76e08941457d4dd173eac60783e55354921137c8b75e8b5c0d2ecca');
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(manifest.dependencies['@deepseek-ai/dsh-scope'],undefined);assert.equal(manifest.overrides['@deepseek-ai/dsh-scope'],undefined);
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-scope'].version,'0.2.0-rc.2');assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-scope'].link,undefined);
 assert.ok(inject.includes('attachments'));
 const patch=await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8');assert.match(patch.split('    - id: ooo-bidpliot-agent-preset')[0],/        - attachments\n/);
});

test('宿主与业务同ID并发：事件和JSONL隔离，模型及附件共用',async()=>{
 const f=await fixture();
 try{
  assert.notEqual(f.scope.ctx.events,f.hostRuntime.ctx.events);
  for(const name of ['llm','agentDefaultModel','subprocess','attachments'])assert.equal(f.scope.ctx[name][symbols.original],f.host[name][symbols.original]);
  let leaks=0;const detach=f.hostRuntime.ctx.on('agent/pre-step',(_payload,next)=>{leaks++;return next()},{global:true});
  const business=await f.agent(f.scope.ctx,'same-id');business.followup(message('BUSINESS_PRIVATE_MARKER'));await business.whenIdle();assert.equal(leaks,0);detach();
  const host=await f.agent(f.hostRuntime.ctx,'same-id');host.followup(message('HOST_PRIVATE_MARKER'));business.followup(message('BUSINESS_PRIVATE_MARKER_2'));await Promise.all([host.whenIdle(),business.whenIdle()]);
  assert.equal(terminal(host).kind,'completed');assert.equal(terminal(business).kind,'completed');
  for(const [ctx,agent,subdir,own,foreign]of [[f.scope.ctx,business,'business','BUSINESS_PRIVATE_MARKER','HOST_PRIVATE_MARKER'],[f.hostRuntime.ctx,host,'host','HOST_PRIVATE_MARKER','BUSINESS_PRIVATE_MARKER']]){
   await ctx.sessions.flush(agent.session);const dir=join(f.dir,subdir,'sessions'),files=(await readdir(dir,{recursive:true})).filter(p=>p.endsWith('.jsonl'));assert.equal(files.length,1);
   const content=await readFile(join(dir,files[0]),'utf8');assert.ok(content.includes(own));assert.ok(!content.includes(foreign));
  }
 }finally{await f.close()}
});

test('请求前缀落盘失败阻止模型派发；工具调用落盘失败阻止工具副作用',async()=>{
 const f=await fixture();
 try{
  const detach=f.scope.ctx.on('session/flush',session=>{
   const events=session.snapshotEvents();
   if(session.id==='request-rejected'&&events.some(e=>e.type==='request/header'))throw new Error('request-prefix persistence rejected');
   if(session.id==='tool-rejected'&&events.some(e=>e.type==='tool/call'))throw new Error('tool-prefix persistence rejected');
  });
  try{
   const agent=await f.agent(f.scope.ctx,'request-rejected');agent.followup(message('REQUEST_BOUNDARY'));await agent.whenIdle();assert.equal(terminal(agent).kind,'error');assert.match(terminal(agent).error.message,/request-prefix persistence rejected/);assert.equal(f.adapter.calls.length,0);
   let sideEffects=0;
   const toolAgent=await f.agent(f.scope.ctx,'tool-rejected',async ctx=>{ctx.tools.register({name:'probe',description:'Temporary side effect',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]},async execute(){sideEffects++;return 'executed'}})});
   toolAgent.followup(message('TOOL_BOUNDARY'));await toolAgent.whenIdle();assert.ok(toolAgent.session.snapshotEvents().some(e=>e.type==='tool/call'));assert.equal(sideEffects,0);
  }finally{detach()}
 }finally{await f.close()}
});

test('本地子Agent失败的原始原因由插件保留',async()=>{
 const f=await fixture();let run;
 try{
  const parent=await f.agent(f.scope.ctx,'diagnostic-parent');
  const detach=f.scope.ctx.on('agent/pre-step',({agent},next)=>{if(agent!==parent)throw new Error('exact child failure');return next()});
  try{
   run=await f.scope.ctx.subagents.start('spawn',{parent,signal:new AbortController().signal,prompt:[{type:'text',text:'diagnostic'}],toolFilter:{allow:[]}});
   const result=await run.result;assert.equal(result.stopReason,'error');assert.equal(result.diagnostic,undefined);
   for(const text of ['子Agent未完成','图片识别未完成','资料整理未完成'])assert.equal(subagentFailure(run,result,text).message,'exact child failure');
  }finally{detach();await run?.dispose()}
 }finally{await f.close()}
});

test('官方pi-ai发送宿主附件字节，业务卸载后宿主模型仍可使用',async()=>{
 const f=await fixture(),received=[];let agent;
 const endpoint=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;received.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const delta of [{content:'wire completed'},{}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'wire',choices:[{index:0,delta,finish_reason:Object.keys(delta).length?null:'stop'}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 try{
  f.hostRuntime.ctx.reflect.provide('credentials',{async resolve(){return {value:'local-test-only'}},async get(){return undefined},async set(){},async list(){return []}});
  await f.hostRuntime.ctx.plugin(PiAi,{providers:{wire:{api:'openai-completions',apiKeyEnv:'LOCAL_TEST_ONLY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'wire',name:'wire',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}});
  const ref=await f.scope.ctx.attachments.saveImage({data:png,mediaType:'image/png'});
  const h=await f.scope.ctx.agents.create({sessionId:'wire-business',meta:{cwd:f.dir},agentOptions:{provider:'wire',model:'wire'}});f.handles.push(h);agent=h.agent;
  agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'read image'},{type:'image',attachment:ref}]}));await agent.whenIdle();assert.equal(terminal(agent).kind,'completed');assert.equal(received.length,1);
  const image=received[0].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='image_url');assert.ok(image.image_url.url.startsWith('data:image/png;base64,'));
  await h.dispose();f.handles.pop();await f.scope.close();
  const host=await f.hostRuntime.ctx.agents.create({sessionId:'wire-host',meta:{cwd:f.dir},agentOptions:{provider:'wire',model:'wire'}});f.handles.push(host);host.agent.followup(message('host remains usable'));await host.agent.whenIdle();assert.equal(terminal(host.agent).kind,'completed');assert.equal(received.length,2);
 }finally{await f.close();await new Promise(resolve=>endpoint.close(resolve))}
});

test('官方压缩组件夹具：长工具回执缩减且原始证据和隔离会话保留',async()=>{
 const f=await fixture();
 try{
  assert.ok(f.scope.ctx.compaction);assert.ok(f.scope.ctx.tokenMeter);assert.ok(f.scope.ctx.toolResultPruner);
  assert.notEqual(f.scope.ctx.tokenMeter,f.hostRuntime.ctx.tokenMeter);
  const original='head '.repeat(110000)+'BUSINESS_PRIVATE_MIDDLE'+' tail'.repeat(110000);
  const agent=await f.agent(f.scope.ctx,'long-tool-evidence',async ctx=>{ctx.tools.register({name:'probe',description:'Long retained evidence',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]},async execute(){return original}})});
  agent.followup(message('TOOL_BOUNDARY'));await agent.whenIdle();
  assert.equal(terminal(agent).kind,'completed');
  const events=agent.session.snapshotEvents();assert.ok(events.some(e=>e.type==='compaction/prune'));
  assert.ok(events.some(e=>e.type==='tool/result'&&e.data.message.content.some(b=>b.type==='text'&&b.text===original)),'原始回执仍保存在持久事件里');
  const request=f.adapter.calls.at(-1),wire=JSON.stringify(request.messages);assert.ok(wire.includes('tool result middle pruned'));assert.ok(!wire.includes('BUSINESS_PRIVATE_MIDDLE'));assert.ok(wire.length<20000);
  assert.equal(f.hostRuntime.ctx.agents.get('long-tool-evidence'),undefined);
 }finally{await f.close()}
});

test('业务关闭等待已开始的冷恢复，释放官方会话后不留下活Agent',async()=>{
 const f=await fixture(),resumeEntered=Promise.withResolvers(),resumeReleased=Promise.withResolvers();
 let runtime;
 try{
  const original=await f.agent(f.scope.ctx,'shutdown-resume');original.followup(message('resume prefix'));await original.whenIdle();await f.handles.pop().dispose();
  const ctx={agents:{get(){return undefined},async resume(){resumeEntered.resolve();await resumeReleased.promise;const h=await f.scope.ctx.agents.resume({resumeSessionId:'shutdown-resume',agentOptions:model});f.handles.push(h);return h}},agentPresets:{async mount(){}},sessions:f.scope.ctx.sessions};
  runtime=new BusinessRuntime(ctx);
  const resuming=runtime.handle({session_id:'shutdown-resume',model});await resumeEntered.promise;
  let closed=false;const closing=runtime.close().then(()=>{closed=true});await new Promise(resolve=>setImmediate(resolve));
  const closedBeforeResume=closed;resumeReleased.resolve();await resuming;await closing;
  assert.equal(closedBeforeResume,false,'close must await an already admitted resume');
  assert.equal(runtime.handles.size,0);assert.equal(f.scope.ctx.agents.get('shutdown-resume'),undefined);
  await assert.rejects(runtime.handle({session_id:'after-close',model}),/正在关闭/);
 }finally{resumeReleased.resolve();await runtime?.close();await f.close()}
});

test('活动业务子Agent停止、尾事件完整落盘与冷恢复后宿主Agent继续运行',{timeout:8000},async()=>{
 const f=await fixture(),logs=[];let runtime,run,reopened;
 try{
  f.scope.ctx.logger.exporter({levels:{default:4},export:entry=>logs.push(entry)});
  f.adapter.childStarted=Promise.withResolvers();
  const parent=await f.agent(f.scope.ctx,'shutdown-parent',async ctx=>{ctx.tools.register({name:'probe',description:'Start shutdown child',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(_args,exec){run=await f.scope.ctx.subagents.start('spawn',{parent:exec.agent,signal:exec.signal,prompt:[{type:'text',text:'CLOSE_CHILD'}],toolFilter:{allow:[]}});try{await run.result;return 'settled'}finally{await run.dispose()}}})});
  runtime=new BusinessRuntime(f.scope.ctx);runtime.handles.set(parent.id,f.handles.at(-1));
  parent.followup(message('CLOSE_PARENT'));await Promise.race([f.adapter.childStarted.promise,parent.whenIdle().then(()=>{throw new Error('Child was not dispatched: '+JSON.stringify(parent.session.snapshotEvents().filter(event=>['tool/result','turn/end'].includes(event.type))))})]);
  await Promise.all([runtime.close(),runtime.close()]);
  assert.equal(f.adapter.childSignal.aborted,true);assert.equal(terminal(parent).kind,'aborted');assert.equal(terminal(run.localAgent).kind,'aborted');
  assert.equal(f.scope.ctx.agents.list().length,0);
  const snapshots=new Map([parent,run.localAgent].map(agent=>[agent.id,agent.session.snapshotEvents()]));
  const failures=logs.filter(entry=>/closed handle|final drain.*failed|best-effort final session flush failed/.test(entry.args.map(String).join(' ')));assert.deepEqual(failures,[]);
  await f.scope.close();reopened=await createBusinessScope(f.hostRuntime.ctx,join(f.dir,'business'));
  for(const [id,events]of snapshots){
   const stored=await reopened.ctx.sessionPersistence.open(id,'read');try{assert.deepEqual((await stored.read()).events,events,'every parent and child tail event persists')}finally{await stored.close()}
   const h=await reopened.ctx.agents.resume({resumeSessionId:id,agentOptions:model});try{assert.deepEqual(h.agent.session.snapshotEvents().slice(0,events.length),events);assert.equal(terminal(h.agent).kind,'aborted')}finally{await h.dispose()}
  }
  const host=await f.agent(f.hostRuntime.ctx,'host-after-shutdown');host.followup(message('HOST_STILL_RUNNING'));await host.whenIdle();assert.equal(terminal(host).kind,'completed');
 }finally{await runtime?.close();await reopened?.close();await f.close()}
});

test('最终会话flush失败明确拒绝关闭结果且仍释放官方Agent',async()=>{
 const f=await fixture();let runtime;
 try{
  const agent=await f.agent(f.scope.ctx,'shutdown-flush-failure');agent.followup(message('durable before shutdown'));await agent.whenIdle();
  runtime=new BusinessRuntime(f.scope.ctx);runtime.handles.set(agent.id,f.handles.at(-1));
  const detach=f.scope.ctx.on('session/flush',()=>{throw new Error('shutdown durability rejected')});
  try{await assert.rejects(runtime.close(),error=>error instanceof AggregateError&&error.errors.some(cause=>cause.message==='shutdown durability rejected'))}finally{detach()}
  assert.equal(runtime.handles.size,0);assert.equal(f.scope.ctx.agents.get(agent.id),undefined);
 }finally{await runtime?.close().catch(()=>{});await f.close()}
});
