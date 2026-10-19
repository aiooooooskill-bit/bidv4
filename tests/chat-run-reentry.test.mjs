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

const name='原生run同轮重入快速拒绝、无新执行或提交泄漏、自然停轮后同会话下一阶段可用';
const flag='BIDV4_CHAT_REENTRY_FIXTURE';
const conflict='当前阶段仍在本会话执行，请完成当前阶段并结束本轮；不要重复调用run。自动流程会继续后续阶段。';
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const call=(id,name,args)=>({id,name,args});
const textOf=message=>typeof message?.content==='string'?message.content:JSON.stringify(message?.content??[]);
async function bounded(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),15000)})])}finally{clearTimeout(timer)}
}

if(process.env[flag]!=='1')test(name,{timeout:60000},()=>runIsolatedTest('chat-run-reentry.test.mjs',flag,new RegExp(name),55000));
else test(name,{timeout:50000},async()=>{
 let ctx,taskId,agent,restoreRun,primaryError;
 const requests=[],runs=[],fixtureErrors=[],teardownErrors=[];
 const endpoint=createServer(async(req,res)=>{
  try{
   const request=await readJson(req);requests.push(request);
   // Anchor to the current user turn. The previous run's stage instructions
   // remain in history and must not send the next turn back into that stage.
   const anchor=request.messages.findLastIndex(message=>message.role==='user'&&/BIDV4_REENTRY_(FIRST|NEXT)/.test(textOf(message)));
   const current=textOf(request.messages[anchor]);
   const step=request.messages.slice(anchor).filter(message=>message.role==='assistant'&&message.tool_calls?.length).length;
   const work=join(dataRoot,'workspace',taskId,'work');
   const write=(id,path,content)=>call(id,'write',{file_path:join(work,path),content});
   const outline='# 响应文件：重入验收册\n\nscope：本机工程验收\n\n## 目录\n- 验收章节\n\n## 来源标注\n\n## 目录说明\n';
   const first=[
    [call('first-analysis','ooo_bidpliot_run',{task_id:taskId,kind:'analyse',main_file:'隔离原件.png',supplements:[]})],
    analysis.map(key=>write('analysis-'+key,'analysis/'+key+'.md','# 重入隔离验收 '+key+'\n本机确定性夹具的合成资料，无评分或业务约束。')),
    [call('reentry-stage','ooo_bidpliot_run',{task_id:taskId,kind:'outline',page_target:null,numbering:'decimal'})],
    [call('reentry-full','ooo_bidpliot_run',{task_id:taskId,kind:'full',resume:true})],
   ];
   const next=[
    [call('next-outline','ooo_bidpliot_run',{task_id:taskId,kind:'outline',page_target:null,numbering:'decimal'})],
    [call('outline-contract','outline_plan',{operation:'complete',volume:'重入验收册',root_titles:'验收章节'})],
    [write('outline-write','outline/tender-response-docs.md',outline)],
    [call('outline-check','check_outline',{})],
    [call('outline-publish','assemble_tender',{})],
   ];
   assert.match(current,/BIDV4_REENTRY_(FIRST|NEXT)/);
   const calls=(current.includes('BIDV4_REENTRY_FIRST')?first:next)[step]??[];
   const delta=calls.length?{tool_calls:calls.map((tool,index)=>({index,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}))}:{content:'本阶段已完成，本轮自然结束。'};
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'reentry-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
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
   {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_REENTRY_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'Local run reentry fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
   {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
   {id:'session-title-llm',disabled:true},
  ]));
  process.env.BIDV4_REENTRY_KEY='local-test-only';
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  const runtime=ctx.get('bidBusiness');assert.ok(runtime);
  const base='http://127.0.0.1:'+ctx.webServer.port,login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');assert.ok(cookie);
  async function api(path,body){
   const response=await fetch(base+'/api/bidv4'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
  }
  ({task:{id:taskId}}=await api('/tasks',{title:'原生同轮重入隔离验收',request_id:randomUUID()}));
  const upload=new FormData();upload.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'隔离原件.png');await api('/files?task_id='+taskId,upload);
  const {workspace}=await ctx.workspaceController.create({path:root});
  const session=await ctx.sessionController.create({workspaceId:workspace.workspaceId,agentPreset:'ooo-bidpliot'});
  agent=ctx.agents.get(session.sessionId);assert.ok(agent);
  async function snapshot(){
   const folder=join(dataRoot,'actions',taskId);
   const files=await readdir(folder).catch(error=>{if(error.code==='ENOENT')return [];throw error});
   return {files:await Promise.all(files.sort().map(async file=>({file,hash:sha(await readFile(join(folder,file)))}))),admissions:runtime.admissions.size,settling:runtime.settling.has(taskId),sameAgent:runtime.handles.get(agent.id)?.agent===agent,locks:(await readdir(join(dataRoot,'locks'))).sort(),workflowStarts:runtime.workflows.starts.size,workflowJobs:runtime.workflows.jobs.size};
  }
  const definition=ctx.tools.get('ooo_bidpliot_run',agent),execute=definition.execute;
  // The SDK deliberately omits ordinary Error properties from tool/result.
  // Observe the original status at the real body boundary, then return/rethrow
  // unchanged; all calls still traverse official model/tool/session pipelines.
  definition.execute=async function(args,exec){
   const before=await snapshot(),started=performance.now();let value,error;
   try{value=await execute.call(this,args,exec);return value}catch(caught){error=caught;throw caught}
   finally{runs.push({callId:exec.callId,kind:args.kind,status:error?.status,message:error?.message,elapsedMs:performance.now()-started,before,after:await snapshot(),value})}
  };
  restoreRun=()=>{definition.execute=execute};
  const resultFor=(events,id)=>events.find(event=>event.type==='tool/result'&&event.data.message.toolCallId===id)?.data.message;
  agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'BIDV4_REENTRY_FIRST：完成解读后重复尝试目录与自动续跑，拒绝后正常结束。'}]}));
  await bounded(agent.whenIdle(),'First native turn must finish after actual conflict results');
  await bounded(runtime.settling.get(taskId),'First action persistence');await ctx.sessions.flush(agent.session);
  let events=agent.session.snapshotEvents();assert.deepEqual(fixtureErrors,[]);
  assert.equal(events.findLast(event=>event.type==='turn/end').data.reason.kind,'completed','No stop or cancellation is needed to finish the conflicting turn');
  const firstResult=resultFor(events,'first-analysis');assert.ok(firstResult);assert.equal(firstResult.isError,false,JSON.stringify(firstResult));assert.match(JSON.stringify(firstResult),/页面输入/);
  const firstRun=runs.find(run=>run.callId==='first-analysis');assert.equal(firstRun.status,undefined);assert.equal(firstRun.after.sameAgent,true);assert.equal(firstRun.after.settling,true);assert.equal(firstRun.after.files.length,2);
  for(const id of ['reentry-stage','reentry-full']){
   const result=resultFor(events,id);assert.ok(result,'The model must receive an actual tool/result for '+id);assert.equal(result.isError,true);assert.match(JSON.stringify(result),new RegExp(conflict));
   const run=runs.find(item=>item.callId===id);assert.equal(run.status,409);assert.equal(run.message,conflict);assert.ok(run.elapsedMs<2000,'Conflict must return promptly, elapsed='+run.elapsedMs);
   assert.equal(run.before.settling,true);assert.equal(run.before.sameAgent,true);assert.equal(run.before.admissions,0);assert.deepEqual(run.after,run.before,'Rejected reentry must not create actions, workflows, locks or retain admission');
  }
  assert.deepEqual(events.filter(event=>event.type==='tool/result'&&event.data.message.isError).map(event=>event.data.message.toolCallId),['reentry-stage','reentry-full']);
  const complete=await api('/page-flow/'+taskId);assert.equal(complete.execution.state,'completed');assert.equal(complete.execution.kind,'analyse');assert.equal(complete.files.filter(file=>file.path.startsWith('analysis/')).length,8);assert.equal(complete.session_id,agent.id);
  assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);assert.equal(runtime.admissions.size,0);assert.equal(runtime.settling.has(taskId),false);assert.equal(runtime.workflows.starts.size,0);assert.equal(runtime.workflows.jobs.size,0);
  const prefix=events.map(event=>sha(JSON.stringify(event)));
  agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'BIDV4_REENTRY_NEXT：在同一会话新一轮正常生成目录。'}]}));
  await bounded(agent.whenIdle(),'Next native turn');await bounded(runtime.settling.get(taskId),'Next action persistence');await ctx.sessions.flush(agent.session);
  events=agent.session.snapshotEvents();assert.deepEqual(fixtureErrors,[]);assert.deepEqual(events.slice(0,prefix.length).map(event=>sha(JSON.stringify(event))),prefix,'The next turn must preserve the original conversation');
  assert.equal(events.findLast(event=>event.type==='turn/end').data.reason.kind,'completed');
  const nextResult=resultFor(events,'next-outline');assert.ok(nextResult);assert.equal(nextResult.isError,false,JSON.stringify(nextResult));assert.match(JSON.stringify(nextResult),/本轮目录派发\/汇总契约/);
  assert.deepEqual(events.slice(prefix.length).filter(event=>event.type==='tool/result'&&event.data.message.isError),[]);
  const nextRun=runs.find(run=>run.callId==='next-outline');assert.equal(nextRun.status,undefined);assert.equal(nextRun.before.settling,false);assert.equal(nextRun.after.files.length,3);
  const finalState=await api('/page-flow/'+taskId);assert.equal(finalState.execution.state,'completed');assert.equal(finalState.execution.kind,'outline');assert.equal(finalState.session_id,agent.id);assert.ok(finalState.directory);assert.match(await readFile(join(dataRoot,'workspace',taskId,'work/outline/tender-response-docs.md'),'utf8'),/重入验收册/);
  const records=await Promise.all((await readdir(join(dataRoot,'actions',taskId))).filter(file=>file.endsWith('.json')&&file!=='latest.json').map(async file=>JSON.parse(await readFile(join(dataRoot,'actions',taskId,file),'utf8'))));
  assert.deepEqual(records.map(record=>record.kind).sort(),['analyse','outline']);assert.deepEqual([...new Set(records.map(record=>record.session_id))],[agent.id]);
  assert.equal(runtime.admissions.size,0);assert.equal(runtime.settling.size,0);assert.equal(runtime.pendingHandles.size,0);assert.equal(runtime.workflows.starts.size,0);assert.equal(runtime.workflows.jobs.size,0);assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);
  assert.equal(requests.length,11,'Two normal turns must finish without model retries or hidden continuation');
 }catch(error){primaryError=error}
 finally{
  restoreRun?.();
  try{await bounded(ctx?.fiber.dispose(),'Web host cleanup')}catch(error){teardownErrors.push(error)}
  endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
 }
 if(primaryError)throw primaryError;
 assert.deepEqual(teardownErrors,[]);
});
