import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root} from '../server/native/business.mjs';
import {startSubtask} from '../server/native/tools.mjs';

const testName='正式Web预设：自动压缩、超限恢复、子Agent与冷恢复均使用官方压缩服务';
const message=text=>createUserMessage({source:{kind:'human'},content:[{type:'text',text}]});
if(process.env.BIDV4_COMPACTION_FIXTURE!=='1')test(testName,{timeout:60000},()=>runIsolatedTest('preset-compaction.test.mjs','BIDV4_COMPACTION_FIXTURE',new RegExp(testName),55000));
else test(testName,{timeout:50000},async()=>{
 let ctx,mode='pressure',overflowed=false;
 const requests=[],handles=[],toolPath=join(root,'long-evidence.txt');
 const original=Array.from({length:150},(_,i)=>`evidence ${i} `+'原始取证内容'.repeat(40)).join('\n');
 const endpoint=createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const request=JSON.parse(raw);requests.push(request);
   const last=request.messages.at(-1);
   const summarizing=JSON.stringify(last).includes('You are now acting as a compaction engine');
   if(mode==='overflow'&&!summarizing&&!overflowed){
    overflowed=true;res.writeHead(400,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:{message:'prompt and max_completion_tokens exceed the context window: 99031 + 32768 > 131072 tokens',type:'invalid_request_error',code:'context_length_exceeded'}}));return;
   }
   const tool=mode==='pressure'&&!summarizing&&!JSON.stringify(request.messages).includes('<compacted-summary>')&&last?.role!=='tool';
   const delta=tool?{content:'工具前规划'.repeat(25000),tool_calls:[{index:0,id:'read-'+randomUUID(),type:'function',function:{name:'read',arguments:JSON.stringify({file_path:toolPath})}}]}:{content:summarizing?'Checkpoint: retain project intent and source paths; continue validating existing files.':'fixture completed'};
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [chunk,finish]of [[delta,null],[{},tool?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
   if(tool)res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[],usage:{prompt_tokens:120000,completion_tokens:50,total_tokens:120050}})+'\n\n');
   res.end('data: [DONE]\n\n');
  }catch(error){res.destroy(error)}
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 try{
  await writeFile(toolPath,original);
  const profile=join(process.env.DSH_HOME,'profiles','web');await mkdir(join(profile,'node_modules'),{recursive:true});
  await symlink(root,join(profile,'node_modules','ooo-bidpliot'),process.platform==='win32'?'junction':'dir');
  await symlink(join(root,'node_modules','@deepseek-ai'),join(profile,'node_modules','@deepseek-ai'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
   {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
   {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_COMPACTION_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'fixture',contextWindow:131072}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
   {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
   {id:'session-title-llm',disabled:true},
  ]));
  process.env.BIDV4_COMPACTION_KEY='local-test-only';
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  assert.equal(ctx.get('compaction'),undefined,'官方Web宿主不提供全局压缩后端');
  assert.equal(ctx.get('toolResultPruner'),undefined);
  assert.ok(ctx.get('tokenMeter'),'计量服务仍由宿主提供');
  const model={provider:'fixture',model:'fixture'},setup=async c=>{await ctx.agentPresets.mount(c,'ooo-bidpliot')};
  const create=async id=>{const h=await ctx.agents.create({sessionId:id,meta:{cwd:root,agentPreset:'ooo-bidpliot'},agentOptions:model,setup});handles.push(h);return h};
  const assertBackend=agent=>{
   assert.ok(ctx.agentPresets.serviceFor(agent,'compaction'));
   assert.ok(ctx.agentPresets.serviceFor(agent,'toolResultPruner'));
  };
  const assertCompacted=agent=>{
   const events=agent.session.snapshotEvents();
   assert.equal(events.findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
   assert.ok(events.some(e=>e.type==='compaction/summary'),JSON.stringify({message:'真实预设应产生官方摘要事件',events:events.filter(e=>e.type.startsWith('compaction/')),requests:requests.map(r=>({lastRole:r.messages.at(-1)?.role,summary:JSON.stringify(r.messages.at(-1)).includes('You are now acting as a compaction engine'),size:JSON.stringify(r.messages).length})),logs:ctx.logger.buffer.slice(-10).map(e=>({name:e.name,args:e.args.map(String)}))}));
   assert.ok(events.some(e=>e.type==='compaction/end'&&!e.data.error));
  };
  const pressure=await create('preset-pressure');assertBackend(pressure.agent);
  pressure.agent.followup(message('PRESSURE '+'背景约束'.repeat(40000)));await pressure.agent.whenIdle();assertCompacted(pressure.agent);
  const events=pressure.agent.session.snapshotEvents();
  assert.ok(events.some(e=>e.type==='compaction/prune'));
  assert.ok(events.some(e=>e.type==='tool/result'&&JSON.stringify(e.data.message).length>8192&&JSON.stringify(e.data.message).includes('evidence 20')),'裁剪后原始长回执仍在日志中');
  assert.equal(await readFile(toolPath,'utf8'),original);
  assert.ok(events.some(e=>e.type==='compaction/summary'&&e.data.maxTokens===8192),'摘要调用使用8192输出预算');
  const summaryRequest=requests.find(r=>JSON.stringify(r.messages.at(-1)).includes('You are now acting as a compaction engine'));
  const summaryCap=summaryRequest.max_tokens??summaryRequest.max_completion_tokens;
  assert.ok(summaryCap>0&&summaryCap<=8192,'实际摘要请求保留输出预算上限');
  await pressure.dispose();handles.splice(handles.indexOf(pressure),1);
  const resumed=await ctx.agents.resume({resumeSessionId:'preset-pressure',agentOptions:model,setup});handles.push(resumed);assertBackend(resumed.agent);
  assertCompacted(resumed.agent);resumed.agent.followup(message('continue retained checkpoint'));await resumed.agent.whenIdle();assertCompacted(resumed.agent);
  mode='overflow';
  const overflow=await create('preset-overflow');assertBackend(overflow.agent);
  const before=requests.length;overflow.agent.followup(message('OVERFLOW '+'待保留的任务事实'.repeat(15000)));await overflow.agent.whenIdle();
  assert.ok(overflowed);assertCompacted(overflow.agent);
  assert.equal(requests.length-before,3,'首次超限、官方摘要、自动重试共三次请求');
  mode='pressure';
  const parent=await create('preset-parent');
  const child=await startSubtask(ctx,{parent:parent.agent,role:'tender-outline-writer',prompt:[{type:'text',text:'CHILD '+'子任务必须保留的背景'.repeat(20000)}],signal:AbortSignal.timeout(10000),label:'compaction-child'});
  const activeChild=ctx.agents.get(child.childId);assert.ok(activeChild);assertBackend(activeChild);
  try{const result=await child.result;assert.equal(result.stopReason,'completed');assertCompacted(activeChild)}finally{await child.dispose()}
  const unrelated=await ctx.agents.create({sessionId:'preset-unrelated',meta:{cwd:root,agentPreset:'standard'},agentOptions:model,setup:async c=>{await ctx.agentPresets.mount(c,'standard')}});handles.push(unrelated);
  assert.notEqual(ctx.agentPresets.serviceFor(unrelated.agent,'compaction'),ctx.agentPresets.serviceFor(parent.agent,'compaction'));
  assert.equal(unrelated.agent.session.snapshotEvents().some(e=>e.type.startsWith('compaction/')),false);
 }finally{
  for(const h of handles.reverse())await h.dispose();
  await ctx?.fiber.dispose();endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
 }
});
