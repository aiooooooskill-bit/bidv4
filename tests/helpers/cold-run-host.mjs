import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {json as readJson} from 'node:stream/consumers';
import {mkdir,readFile,readdir,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {root,dataRoot} from '../../server/native/business.mjs';

// A separate process is required: SIGKILL must bypass all real plugin and
// official Agent shutdown hooks, while preserving the actual profile/logs.
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const textOf=message=>typeof message?.content==='string'?message.content:JSON.stringify(message?.content??[]);
const call=(id,name,args)=>({id,name,args});
const draft='# 响应文件：冷恢复验收册\n\nscope：本机工程验收\n\n## 目录\n- 封面\n- 目录\n- 验收章节\n\n## 来源标注\n\n## 目录说明\n';
let ctx,taskId,sessionId,ending=false;
const requests=[],fixtureErrors=[],checkpoint=Promise.withResolvers();
const endpoint=createServer(async(req,res)=>{
 try{
  const request=await readJson(req);requests.push(request);
  const anchor=request.messages.findLastIndex(message=>message.role==='user'&&/BIDV4_COLD_(ANALYSE|CRASH|RESUME)/.test(textOf(message)));
  assert.ok(anchor>=0,'A cold-recovery model request must belong to an explicit native user turn');
  const prompt=textOf(request.messages[anchor]),messages=request.messages.slice(anchor),step=messages.filter(message=>message.role==='assistant'&&message.tool_calls?.length).length;
  const work=join(dataRoot,'workspace',taskId,'work');
  const write=(id,path,content)=>call(id,'write',{file_path:join(work,path),content});
  const analyse=[
   [call('cold-analysis','ooo_bidpliot_run',{task_id:taskId,kind:'analyse',main_file:'隔离原件.png',supplements:[]})],
   analysis.map(key=>write('cold-analysis-'+key,'analysis/'+key+'.md','# 冷恢复隔离验收 '+key+'\n本机确定性夹具，无评分或业务约束。')),
  ];
  const crash=[
   [call('cold-outline-original','ooo_bidpliot_run',{task_id:taskId,kind:'outline',page_target:null,numbering:'decimal'})],
   [write('cold-outline-draft','outline/tender-response-docs.md',draft)],
  ];
  const resume=[
   [call('cold-outline-resume','ooo_bidpliot_run',{task_id:taskId,kind:'outline',page_target:null,numbering:'decimal'})],
   [call('cold-draft-read','read',{file_path:join(work,'outline/tender-response-docs.md')})],
   [call('cold-outline-contract','outline_plan',{operation:'complete',volume:'冷恢复验收册',root_titles:'封面\n目录\n验收章节'})],
   [call('cold-outline-check','check_outline',{})],
   [call('cold-outline-publish','assemble_tender',{})],
  ];
  const sequence=prompt.includes('BIDV4_COLD_ANALYSE')?analyse:prompt.includes('BIDV4_COLD_CRASH')?crash:resume;
  // A failing run must reach a real durable tool/result and naturally end.
  // Do not paper over it by issuing business tools directly afterward.
  const runFailed=messages.some(message=>message.role==='tool'&&String(message.content).startsWith('Error:'));
  const calls=runFailed?[]:sequence[step]??[];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(prompt.includes('BIDV4_COLD_CRASH')&&step===2&&!runFailed){
   res.write('data: '+JSON.stringify({id:'cold-crash-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:'目录草稿已写入，尚未校验发布。'},finish_reason:null}]})+'\n\n');
   checkpoint.resolve();return;
  }
  const delta=calls.length?{tool_calls:calls.map((tool,index)=>({index,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}))}:{content:runFailed?'执行工具返回错误，本轮自然结束。':'本阶段已完成，本轮自然结束。'};
  for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'cold-run-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 }catch(error){fixtureErrors.push(error.stack);res.destroy(error)}
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
for(const [name,target]of [['ooo-bidpliot',root],['@deepseek-ai',join(root,'node_modules/@deepseek-ai')]])try{await symlink(target,join(profile,'node_modules',name),process.platform==='win32'?'junction':'dir')}catch(error){if(error.code!=='EEXIST')throw error}
await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
 {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_COLD_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'Local cold run fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
 {id:'session-title-llm',disabled:true},
]));
process.env.BIDV4_COLD_KEY='local-test-only';
const {runProfile}=await import('../../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
assert.ok(ctx.get('bidBusiness'));
const base='http://127.0.0.1:'+ctx.webServer.port,login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');assert.ok(cookie);
async function api(path,body){
 const response=await fetch(base+'/api/bidv4'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
}
async function records(){return Promise.all((await readdir(join(dataRoot,'actions',taskId))).filter(file=>file.endsWith('.json')&&file!=='latest.json').map(async file=>JSON.parse(await readFile(join(dataRoot,'actions',taskId,file),'utf8'))))}
async function evidence(){
 const runtime=ctx.get('bidBusiness'),observation=await ctx.sessionQuery.observeSession(sessionId,{projectionMode:'none'});
 try{
  const work=join(dataRoot,'workspace',taskId,'work'),files={};
  for(const path of [...analysis.map(key=>'analysis/'+key+'.md'),'outline/tender-response-docs.md'])try{files[path]=sha(await readFile(join(work,path)))}catch(error){if(error.code!=='ENOENT')throw error}
  return {taskId,sessionId,files,events:observation.events,records:await records(),state:await api('/page-flow/'+taskId),modelRequests:requests.length,fixtureErrors,admissions:runtime.admissions.size,settling:runtime.settling.size,locks:await readdir(join(dataRoot,'locks'))};
 }finally{observation[Symbol.dispose]()}
}
async function prompt(text){await ctx.sessionController.prompt({requestId:randomUUID(),sessionId,mode:'queue',content:[{type:'text',text}]},new AbortController().signal)}
async function waitIdle(){const agent=ctx.agents.get(sessionId);assert.ok(agent);await agent.whenIdle();await ctx.get('bidBusiness').settling.get(taskId);await ctx.sessions.flush(agent.session)}
async function close(){
 if(ending)return;ending=true;
 const logs=ctx.logger.buffer,runtimeLogs=ctx.get('bidBusiness').ctx.logger.buffer;
 try{await ctx.fiber.dispose()}finally{endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve))}
 const failures=[...logs,...runtimeLogs].filter(entry=>/closed handle|final drain.*failed|best-effort final session flush failed|unhandled rejection/i.test(entry.args.map(String).join(' '))).map(entry=>({name:entry.name,args:entry.args.map(String)}));
 assert.deepEqual(failures,[],'Cold-recovery host cleanup must not hide persistence failures');
}
process.on('message',async({id,command,args})=>{
 try{
  let result;
  if(command==='seed'){
   ({task:{id:taskId}}=await api('/tasks',{title:'原生冷恢复隔离验收',request_id:randomUUID()}));
   const upload=new FormData();upload.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'隔离原件.png');await api('/files?task_id='+taskId,upload);
   const {workspace}=await ctx.workspaceController.create({path:root});({sessionId}=await ctx.sessionController.create({workspaceId:workspace.workspaceId,agentPreset:'ooo-bidpliot'}));
   await prompt('BIDV4_COLD_ANALYSE：完成解读并正常结束本轮。');await waitIdle();
   const completed=await evidence();assert.equal(completed.state.execution.state,'completed');assert.equal(completed.state.execution.kind,'analyse');assert.equal(Object.keys(completed.files).length,8);
   await prompt('BIDV4_COLD_CRASH：取得目录契约并保存草稿，等待测试强制退出。');await checkpoint.promise;
   await ctx.sessions.flush(ctx.agents.get(sessionId).session);result=await evidence();result.completedAnalysis=completed;
  }else if(command==='open'){
   ({taskId,sessionId}=args);assert.equal(requests.length,0);
   // This is the Web native conversation's ordinary opening path: deliver
   // cold history, then activate the same official Agent without any prompt.
   const abort=new AbortController(),iterator=ctx.sessionController.follow({address:{kind:'session',sessionId},assistantStream:true,maxMessages:100},abort.signal);
   try{await iterator.next();const resolved=await ctx.sessionController.resolveAgent(sessionId);if('error'in resolved)throw resolved.error;await resolved.agent.whenIdle()}finally{abort.abort();await iterator.return?.()}
   result=await evidence();assert.equal(result.modelRequests,0);
  }else if(command==='continue'){
   await prompt('BIDV4_COLD_RESUME：在原会话新轮启动目录，先读取已有草稿再校验发布，不重写已有成果。');await waitIdle();result=await evidence();
   const runtime=ctx.get('bidBusiness'),orphan=result.records.find(record=>record.action_id===args.orphanActionId),agent=ctx.agents.get(sessionId);
   assert.ok(orphan);result.orphanExecution=runtime.executionView(orphan,agent);result.orphanProjection=await runtime.projection(orphan);
  }else if(command==='close'){
   await close();process.send({id,result:{closed:true}});process.disconnect();return;
  }else throw new Error('Unknown cold fixture command: '+command);
  process.send({id,result});
 }catch(error){process.send({id,error:{message:error.message,stack:error.stack}})}
});
process.on('SIGTERM',()=>close().then(()=>process.exit(0)));
process.send({ready:true,result:{modelRequests:requests.length}});
