import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {json as readJson} from 'node:stream/consumers';
import {createHash,randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot} from '../server/native/business.mjs';

const name='自然停轮写盘未结束时同会话可启动下一阶段，旧执行边界和成果保持不变';
const flag='BIDV4_CHAT_SETTLEMENT_FIXTURE';
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const call=(id,name,args)=>({id,name,args});
const textOf=message=>typeof message?.content==='string'?message.content:JSON.stringify(message?.content??[]);
async function bounded(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),15000)})])}finally{clearTimeout(timer)}
}

if(process.env[flag]!=='1')test(name,{timeout:90000},()=>runIsolatedTest('chat-run-settlement.test.mjs',flag,new RegExp(name),85000));
else test(name,{timeout:80000},async t=>{
 await t.test('自然完成后新一轮目录等待旧保存并发布',()=>settlementScenario('outline'));
 await t.test('保存待答状态期间原生答复在首步接管并完成',()=>settlementScenario('answer'));
});

async function settlementScenario(mode){
 const originalHome=process.env.DSH_HOME;
 process.env.DSH_HOME=join(originalHome,mode);
 let ctx,taskId,agent,runtime,restoreFlush,restoreRun,restoreGet,primaryError;
 let firstBoundary,firstSettlement,flushBlocked=false,flushReleased=false,nextInvoked=false;
 const flushEntered=Promise.withResolvers(),releaseFlush=Promise.withResolvers(),nextWaiting=Promise.withResolvers(),nextFinished=Promise.withResolvers();
 const requests=[],runs=[],fixtureErrors=[],teardownErrors=[];
 const endpoint=createServer(async(req,res)=>{
  try{
   const request=await readJson(req);requests.push(request);
   const anchor=request.messages.findLastIndex(message=>message.role==='user'&&(/BIDV4_SETTLEMENT_(FIRST|NEXT)/.test(textOf(message))||textOf(message).includes('answer_to_pending_question')));
   const current=textOf(request.messages[anchor]);
   const step=request.messages.slice(anchor).filter(message=>message.role==='assistant'&&message.tool_calls?.length).length;
   const work=join(dataRoot,'workspace',taskId,'work');
   const write=(id,path,content)=>call(id,'write',{file_path:join(work,path),content});
   const outline='# 响应文件：交接验收册\n\nscope：本机工程验收\n\n## 目录\n- 验收章节\n\n## 来源标注\n\n## 目录说明\n';
   const first=[
    [call('first-analysis','ooo_bidpliot_run',{task_id:taskId,kind:'analyse',main_file:'隔离原件.png',supplements:[]})],
    analysis.map(key=>write('analysis-'+key,'analysis/'+key+'.md','# 交接隔离验收 '+key+'\n本机确定性夹具的合成资料，无评分或业务约束。')),
    ...(mode==='answer'?[[call('pending-question','ask_user_question',{questions:[{id:'term',question:'合成验收维护期？',options:[{label:'三年'},{label:'五年'}]}]})]]:[]),
   ];
   const next=[
    [call('next-outline','ooo_bidpliot_run',{task_id:taskId,kind:'outline',page_target:null,numbering:'decimal'})],
    [call('outline-contract','outline_plan',{operation:'complete',volume:'交接验收册',root_titles:'验收章节'})],
    [write('outline-write','outline/tender-response-docs.md',outline)],
    [call('outline-check','check_outline',{})],
    [call('outline-publish','assemble_tender',{})],
   ];
   assert.match(current,/BIDV4_SETTLEMENT_(FIRST|NEXT)|answer_to_pending_question/);
   // A real native reply receives its final text on its first model request.
   // No second step can accidentally repair a missed continuation handover.
   const calls=current.includes('answer_to_pending_question')?[]:(current.includes('BIDV4_SETTLEMENT_FIRST')?first:next)[step]??[];
   const delta=calls.length?{tool_calls:calls.map((tool,index)=>({index,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}))}:{content:'本阶段完成，本轮自然结束。'};
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'settlement-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
   res.end('data: [DONE]\n\n');
  }catch(error){fixtureErrors.push(error.stack);res.destroy(error)}
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 try{
  const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
  await symlink(root,join(profile,'node_modules/ooo-bidpliot'),process.platform==='win32'?'junction':'dir');
  await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
   {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
   {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_SETTLEMENT_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'Local settlement fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
   {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
   {id:'session-title-llm',disabled:true},
  ]));
  process.env.BIDV4_SETTLEMENT_KEY='local-test-only';
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  runtime=ctx.get('bidBusiness');assert.ok(runtime);
  const base='http://127.0.0.1:'+ctx.webServer.port,login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');assert.ok(cookie);
  async function api(path,body){
   const response=await fetch(base+'/api/bidv4'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
  }
  ({task:{id:taskId}}=await api('/tasks',{title:'自然停轮写盘交接隔离验收',request_id:randomUUID()}));
  const upload=new FormData();upload.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'隔离原件.png');await api('/files?task_id='+taskId,upload);
  const {workspace}=await ctx.workspaceController.create({path:root});
  const session=await ctx.sessionController.create({workspaceId:workspace.workspaceId,agentPreset:'ooo-bidpliot'});
  agent=ctx.agents.get(session.sessionId);assert.ok(agent);
  const actionPath=join(dataRoot,'actions',taskId);
  const records=async()=>Promise.all((await readdir(actionPath)).filter(file=>file.endsWith('.json')&&file!=='latest.json').map(async file=>JSON.parse(await readFile(join(actionPath,file),'utf8'))));
  const analysisHashes=async()=>Object.fromEntries(await Promise.all(analysis.map(async key=>[key,sha(await readFile(join(dataRoot,'workspace',taskId,'work/analysis',key+'.md')))])));
  const resultFor=(events,id)=>events.find(event=>event.type==='tool/result'&&event.data.message.toolCallId===id)?.data.message;

  const flush=ctx.sessions.flush;
  // Hold only the first main Agent's post-idle persistence. SDK execution,
  // model requests, event recording and all other session flushes remain real.
  ctx.sessions.flush=async function(session){
   const events=session===agent.session?session.snapshotEvents():[];
   if(!flushBlocked&&session===agent.session&&agent.status!=='running'&&events.findLast(event=>event.type==='turn/end')?.data.reason.kind==='completed'){
    flushBlocked=true;firstBoundary=events.at(-1).seq;flushEntered.resolve();
    await releaseFlush.promise;flushReleased=true;
   }
   return flush.call(this,session);
  };
  restoreFlush=()=>{ctx.sessions.flush=flush};
  const get=runtime.settling.get;
  // Observe the actual await of the old settlement, without adding a timer or
  // changing its promise. A rejection races this signal for a useful red case.
  runtime.settling.get=function(key){
   const pending=get.call(this,key);
   if(nextInvoked&&!flushReleased&&key===taskId&&pending===firstSettlement)nextWaiting.resolve({kind:'waiting'});
   return pending;
  };
  restoreGet=()=>{runtime.settling.get=get};
  const definition=ctx.tools.get('ooo_bidpliot_run',agent),execute=definition.execute;
  definition.execute=async function(args,exec){
   if(exec.callId==='next-outline')nextInvoked=true;
   let value,error;
   try{value=await execute.call(this,args,exec);return value}catch(caught){error=caught;throw caught}
   finally{
    runs.push({callId:exec.callId,kind:args.kind,status:error?.status,message:error?.message});
    if(exec.callId==='next-outline')nextFinished.resolve({kind:'finished',status:error?.status,message:error?.message});
   }
  };
  restoreRun=()=>{definition.execute=execute};

  agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'BIDV4_SETTLEMENT_FIRST：完成八份解读，本轮自然结束。'}]}));
  await bounded(flushEntered.promise,'First main session post-idle flush gate');
  await bounded(agent.whenIdle(),'First native turn is idle while its persistence is gated');
  let events=agent.session.snapshotEvents();assert.deepEqual(fixtureErrors,[]);
  assert.equal(events.findLast(event=>event.type==='turn/end').data.reason.kind,'completed');
  assert.equal(agent.status,'idle');assert.equal(flushReleased,false);
  const firstResult=resultFor(events,'first-analysis');assert.ok(firstResult);assert.equal(firstResult.isError,false,JSON.stringify(firstResult));
  firstSettlement=runtime.settling.get(taskId);assert.ok(firstSettlement);
  const [firstRecord]=await records();assert.equal(firstRecord.kind,'analyse');
  const hashes=await analysisHashes(),prefix=events.map(event=>sha(JSON.stringify(event)));
  const firstRequests=requests.length;
  assert.equal(firstBoundary,events.at(-1).seq);
  assert.deepEqual(await readdir(join(dataRoot,'locks')),[taskId]);
  assert.equal(firstRecord.outcome??null,null,'The original outcome has not reached disk while its flush is blocked');
  nextInvoked=true;
  if(mode==='answer'){
   const questions=ctx.sessionProjections.snapshot(agent.session,['userQuestions']).values.userQuestions.active;
   assert.deepEqual(questions.filter(question=>question.state==='continued').map(question=>question.callId),['pending-question']);
   assert.equal(ctx.userQuestions.answer(agent,'pending-question',{answers:[{id:'term',selected:['三年']}]}),true,'Use the official native reply API while the old flush is pending');
  }else agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'BIDV4_SETTLEMENT_NEXT：同会话新一轮生成并发布目录。'}]}));
  const next=await bounded(Promise.race([nextWaiting.promise,nextFinished.promise,agent.whenIdle().then(()=>({kind:'idle-before-persistence'}))]),'Next native run enters the previous settlement');
  assert.equal(next.kind,'waiting','New turn must await the already-idle action, not reject it: '+JSON.stringify(next));
  assert.equal(flushReleased,false,'The new turn reaches the old pending promise before its flush is released');
  assert.equal(agent.status,'running');
  assert.ok(agent.session.snapshotEvents().findLast(event=>event.type==='turn/start').seq>firstBoundary,'The official second turn has really started');
  const beforeReleaseRequests=requests.length;
  releaseFlush.resolve();
  await bounded(firstSettlement,'Old action persistence after flush release');
  const settledFirst=(await records()).find(record=>record.action_id===firstRecord.action_id);
  if(mode==='outline'){
   assert.equal(settledFirst.end_seq,firstBoundary,'Old action must freeze the first idle boundary, excluding the new turn');
   assert.equal(settledFirst.outcome.state,'completed','The next live turn must not turn the old outcome back to running');
   assert.deepEqual(settledFirst.outcome.questions,[]);
  }
  assert.equal(beforeReleaseRequests,firstRequests,'The pre-step barrier holds the new model request until the old state is saved');
  await bounded(agent.whenIdle(),'Second native turn');
  await bounded(runtime.settling.get(taskId),'Second action persistence');await ctx.sessions.flush(agent.session);

  events=agent.session.snapshotEvents();assert.deepEqual(fixtureErrors,[]);
  assert.deepEqual(events.slice(0,prefix.length).map(event=>sha(JSON.stringify(event))),prefix,'The old native session prefix is immutable');
  assert.deepEqual(events.filter(event=>event.type==='turn/end').map(event=>event.data.reason.kind),['completed','completed']);
  assert.deepEqual(events.filter(event=>event.type==='tool/result'&&event.data.message.isError),[]);
  const finalRecords=await records(),original=finalRecords.find(record=>record.action_id===firstRecord.action_id),nextRecord=finalRecords.find(record=>record.kind==='outline');
  if(mode==='outline'){
   const nextResult=resultFor(events,'next-outline');assert.ok(nextResult);assert.equal(nextResult.isError,false,JSON.stringify(nextResult));assert.match(JSON.stringify(nextResult),/本轮目录派发\/汇总契约/);
   assert.deepEqual(runs.map(run=>({callId:run.callId,status:run.status})),[{callId:'first-analysis',status:undefined},{callId:'next-outline',status:undefined}]);
   assert.equal(finalRecords.length,2);assert.ok(nextRecord);assert.ok(nextRecord.start_seq>firstBoundary);assert.equal(nextRecord.end_seq,events.at(-1).seq);
   assert.deepEqual(original,settledFirst,'Finishing the new action must not rewrite the old completed action');
   assert.deepEqual(finalRecords.map(record=>record.outcome.state),['completed','completed']);
  }else{
   assert.equal(finalRecords.length,1,'The native reply continues the same action');
   assert.equal(original.action_id,firstRecord.action_id);assert.ok(original.start_seq>firstBoundary);assert.equal(original.end_seq,events.at(-1).seq);
   assert.equal(original.outcome.state,'completed','The reply must not remain needs_input after its first and only model step');assert.deepEqual(original.outcome.questions,[]);
   const nextEvents=events.slice(prefix.length);
   assert.ok(nextEvents.some(event=>event.type==='user/message'&&event.data.message?.source?.kind==='user-question-reply'||event.type==='user/message'&&event.data.source?.kind==='user-question-reply'));
   assert.deepEqual(nextEvents.filter(event=>event.type==='tool/call'),[],'The reply finishes directly, with no repair step or tool');
   assert.equal(requests.length-firstRequests,1,'The native reply has exactly one final-text model request');
   assert.deepEqual(ctx.sessionProjections.snapshot(agent.session,['userQuestions']).values.userQuestions.active,[]);
   assert.deepEqual(runs.map(run=>run.callId),['first-analysis']);
  }
  assert.deepEqual([...new Set(finalRecords.map(record=>record.session_id))],[agent.id]);
  assert.deepEqual(await analysisHashes(),hashes,'All eight analysis originals remain byte-identical');
  const state=await api('/page-flow/'+taskId);assert.equal(state.execution.state,'completed');assert.equal(state.execution.kind,mode==='outline'?'outline':'analyse');assert.equal(state.session_id,agent.id);
  if(mode==='outline'){assert.ok(state.directory);assert.match(await readFile(join(dataRoot,'workspace',taskId,'work/outline/tender-response-docs.md'),'utf8'),/交接验收册/)}
  assert.equal(runtime.admissions.size,0);assert.equal(runtime.executionOwners.size,0);assert.equal(runtime.settling.size,0);assert.equal(runtime.pendingHandles.size,0);assert.equal(runtime.workflows.starts.size,0);assert.equal(runtime.workflows.jobs.size,0);assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);
  assert.equal(requests.length,mode==='outline'?9:5,'Two turns finish without retries or hidden continuation');
 }catch(error){primaryError=error}
 finally{
  releaseFlush.resolve();restoreFlush?.();restoreRun?.();restoreGet?.();
  try{await bounded(ctx?.fiber.dispose(),'Web host cleanup')}catch(error){teardownErrors.push(error)}
  endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
  process.env.DSH_HOME=originalHome;
 }
 if(primaryError)throw primaryError;
 assert.deepEqual(teardownErrors,[]);
}
