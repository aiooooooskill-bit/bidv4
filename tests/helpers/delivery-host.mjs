import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';

// This driver imports the official runtime from the freshly prepared installation.
// It never changes a production profile or calls a remote model provider.
const installation=process.env.BID_DELIVERY_INSTALL;
assert.ok(installation,'BID_DELIVERY_INSTALL is required');
const requireInstalled=createRequire(join(installation,'package.json'));
const installed=name=>import(pathToFileURL(requireInstalled.resolve(name)).href);
const {loadLayeredEnv}=await installed('@deepseek-ai/dsh-app-boot');
const {runProfile}=await installed('@deepseek-ai/dsh/profile-boot');
const {createUserMessage}=await installed('@deepseek-ai/dsh-llm');
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const directory={response_documents:[{name:'本地目录验收册',directory:[{目录名称:'交付验收章节',level:1,children:[]}]}]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sessionEvidence=events=>({eventCount:events.length,eventHashes:events.map(e=>sha(JSON.stringify(e))),lastTurn:events.findLast(e=>e.type==='turn/end')?.data.reason.kind});
const call=(name,args)=>({name,args});
const requests=[];
let blocking=false,hostContext;
const blocked=Promise.withResolvers(),cancelled=Promise.withResolvers();
const endpoint=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/login'&&hostContext){res.writeHead(302,{Location:hostContext.connection.authenticatedUrl('http://127.0.0.1:'+hostContext.webServer.port)});res.end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const request=JSON.parse(raw);requests.push({tools:request.tools?.map(t=>t.function?.name??t.name),model:request.model});
  const text=request.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const latestUser=request.messages.findLast(m=>m.role==='user'),latestText=typeof latestUser?.content==='string'?latestUser.content:JSON.stringify(latestUser?.content??[]);
  const payload=text.match(/页面输入：(\{[^\n]+\})/),kind=payload?JSON.parse(payload[1]).kind:null;
  const cwd=text.match(/当前任务绝对路径：([^；]+)；/)?.[1];
  const step=request.messages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).length;
  const write=(path,content)=>call('write',{file_path:join(cwd,'work',path),content});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(text.includes('delivery-cancel-child')){
   res.write(': waiting for cancellation\n\n');res.once('close',()=>cancelled.resolve());blocked.resolve();return;
  }
  let calls=[],content='本地目录验收执行完成。';
  const statusTools=request.tools?.filter(t=>(t.function?.name??t.name)==='ooo_bidpliot_status')??[];
  if(statusTools.length){
   const lastTool=request.messages.findLast(m=>m.role==='tool');
   // A real host Agent loop selects the tool, executes it, then writes the reply.
   if(request.messages.at(-1)?.role!=='tool')calls=[call('ooo_bidpliot_status',latestText.match(/task_id=([^\s]+)/)?{task_id:latestText.match(/task_id=([^\s]+)/)[1]}:{})];
   else{
    const status=JSON.parse(String(lastTool.content));
    content=status.tasks?'招投标工作台项目：\n'+status.tasks.map(t=>'- '+t.title+'（task_id='+t.id+'）').join('\n'):
     '项目 '+status.task_id+' 当前执行状态：'+status.execution?.state+'。\n\n'+status.outputs.map(o=>'- ['+o.name+'下载]('+o.link+')').join('\n')+'\n\n'+status.documents.map(d=>'- ['+d.name+']('+d.link+')').join('\n');
   }
  }else if(text.includes('调用read_image读取图片：')){
   if(step===0)calls=[call('read_image',{file_path:text.match(/调用read_image读取图片：(.+?)。/)?.[1]})];
   else content='# 招标资料转写\n项目名称：本地目录安装与数据保留验收\n维护期：三年。\n采购内容为信息系统建设、上线培训及后续维护。投标人应提供清晰的项目实施安排、人员职责、交付文件和验收方法。投标文件须包含响应目录、实施方案、技术措施、质量管理和服务保障。所有原始附件应完整保存，生成的正文与整册文件应可查询、预览及下载。本文是确定性本机验收夹具的模拟招标材料，不代表实际采购项目。';
  }else if(text.includes('delivery-body-child')){
   if(step===0)calls=[call('docx_section_create',{path:'body/交付验收章节.docx',title:'交付验收章节',paragraphs:'本地目录交付原段落'})];
   if(step===1)calls=[call('validate_body',{section:'body/交付验收章节.docx'})];
  }else{
   if(kind==='analyse'&&step===0)calls=[call('parse_document',{file_name:'交付验收原件.png'})];
   if(kind==='analyse'&&step===1)calls=analysis.map(n=>write('analysis/'+n+'.md','# 本地目录验收 '+n+'\n固定目录安装、更新、重装使用的真实业务成果。'));
   if(kind==='outline')calls=step===0?[call('write',{file_path:join(cwd,'_meta/staging/tender-response-docs.json'),content:JSON.stringify(directory)})]:step===1?[call('publish_artifact',{contract:'tender.directory/tender-response-docs@1',draft_path:join(cwd,'_meta/staging/tender-response-docs.json')})]:[];
   if(kind==='guide'&&step===0)calls=[write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付验收章节 | 推理撰写 | — | — | 无 |')];
   if(kind==='promises'&&step===0)calls=[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |')];
   if(kind==='body')calls=step===0?[call('task',{subagent_type:'tender-body-writer',description:blocking?'delivery-cancel-child':'delivery-body-child'})]:step===1?[call('check_pipeline_state',{}),call('validate_body',{section:'body'})]:[];
   if(kind==='revise')calls=step===0?[call('docx_section_revise',{path:'body/交付验收章节.docx',edits:JSON.stringify([{para:2,action:'replace',find:'本地目录交付原段落',text:'本地目录交付修订段落'}])})]:step===1?[call('validate_body',{section:'body/交付验收章节.docx'})]:[];
   if(kind==='build'){
    const replied=text.includes('answer_to_pending_question');
    const sequence=[
     [call('build_preparation',{})],
     [write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付验收章节 | 推理撰写 | — | — | 无 |')],
     [call('validate_body',{section:'body/写作指引.md'})],
     [call('build_preparation',{stage:'guide'})],
     [call('ask_user_question',{questions:[{id:'term',question:'维护期是多少？',options:[{label:'三年'},{label:'五年'}]}]})],
     replied?[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |')]:[],
     [call('build_preparation',{stage:'promises'})],
     [call('task',{subagent_type:'tender-body-writer',description:'delivery-body-child'})],
     [call('check_pipeline_state',{}),call('validate_body',{section:'body'}),call('docx_assemble_volume',{})],
    ];calls=sequence[step]??[];
   }
  }
  const delta=calls.length?{tool_calls:calls.map((c,index)=>({index,id:'delivery-'+step+'-'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content};
  for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'delivery-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error)}
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
const profile=join(process.env.DSH_HOME,'profiles','web');
await mkdir(profile,{recursive:true});
// Only deterministic test settings are supplied here. Plugin registration is
// exclusively performed by `dsh plugin add/remove` in the parent verifier.
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
 {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BID_DELIVERY_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'本机交付验收模型',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
 {id:'session-title-llm',disabled:true},
]));
process.env.BID_DELIVERY_FIXTURE_KEY='local-delivery-test-only';
const {ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']});
hostContext=ctx;
const base='http://127.0.0.1:'+ctx.webServer.port;
const login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'});
const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');assert.ok(cookie);
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
}
const send=value=>process.send?.(value);
const presetId='ooo-bidpliot',model={provider:'fixture',model:'fixture'};
const timeout=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error(label+' timed out')),20000);t.unref()})]);
async function queryAgent(taskId,sessionId,resume=false){
 const setup=async c=>{await ctx.agentPresets.mount(c,presetId)};
 const handle=resume?await ctx.agents.resume({resumeSessionId:sessionId,agentOptions:model,setup}):await ctx.agents.create({sessionId,meta:{cwd:installation,agentPreset:presetId},agentOptions:model,setup});
 try{
  assert.deepEqual(ctx.tools.schemas(handle.agent).map(t=>t.name),['ooo_bidpliot_status']);
  const start=requests.length;
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'查询项目进度和文档链接 task_id='+taskId}]}));
  await timeout(handle.agent.whenIdle(),'independent Agent');
  const events=handle.agent.session.snapshotEvents();
  assert.equal(events.findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
  const result=events.findLast(e=>e.type==='tool/result');assert.ok(result);assert.equal(result.data.message.isError,false,JSON.stringify(result.data));
  const actual=JSON.parse(result.data.message.content.find(c=>c.type==='text').text);
  assert.equal(actual.task_id,taskId);assert.ok(actual.outputs.length);assert.ok(actual.documents.length);
  for(const {link} of [...actual.outputs,...actual.documents]){const url=new URL(link);assert.ok(['http:','https:'].includes(url.protocol),'Agent links must be absolute HTTP(S) URLs');assert.equal(url.origin,base,'Agent links must use the current official local host');}
  assert.ok(events.findLast(e=>e.type==='assistant/message').data.message.content.some(c=>c.type==='text'&&c.text.includes(']('+actual.outputs[0].link+')')),'Final Agent reply must expose the actual download link');
  assert.ok(requests.length>=start+2,'Must perform the real model→tool→reply cycle');
  const requestsInTurn=requests.slice(start);assert.ok(requestsInTurn.every(r=>r.tools.every(n=>n==='ooo_bidpliot_status')));
  const document=actual.documents.find(d=>d.name==='structure.md'),documentResponse=await fetch(document.link,{headers:{Cookie:cookie}});
  assert.equal(documentResponse.status,200);assert.match((await documentResponse.json()).content,/本地目录验收 structure/);
  const output=await fetch(actual.outputs[0].link,{headers:{Cookie:cookie}});assert.equal(output.status,200);
  return {sessionId,...sessionEvidence(events),toolCalls:events.filter(e=>e.type==='tool/result').length,taskId:actual.task_id,document:document.link,output:actual.outputs[0].link,outputHash:sha(Buffer.from(await output.arrayBuffer())),modelRequests:requests.length-start};
 }finally{await handle.dispose()}
}
async function overview(){
 const publicPresets=await ctx.agentPresets.list(),runtime=ctx.get('bidBusiness');
 return {base,loginUrl:'http://127.0.0.1:'+endpoint.address().port+'/login',active:!!runtime,publicPresets:publicPresets.map(p=>({id:p.id,broken:p.broken})),privatePresets:runtime?(await runtime.ctx.agentPresets.list()).map(p=>({id:p.id,broken:p.broken})):[],tasks:runtime?await api('/tasks'):null};
}
async function hostProbe(){
 const defaultId=ctx.agentPresets.defaultId;
 const handle=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:installation,agentPreset:defaultId},agentOptions:model,setup:async c=>{await ctx.agentPresets.mount(c,defaultId)}});
 const remove=ctx.tools.register({name:'delivery_host_write_probe',description:'Host capability isolation probe',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:()=>[]},execute:async()=> 'probe'});
 try{
  assert.ok(ctx.tools.get('delivery_host_write_probe',handle.agent));assert.equal(ctx.tools.get('ooo_bidpliot_status',handle.agent),undefined);
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'确认宿主普通 Agent 正常运行。'}]}));await handle.agent.whenIdle();
  assert.equal(handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
  return {defaultPreset:defaultId,writeToolVisible:true,pluginToolAbsent:true,completed:true};
 }finally{remove();await handle.dispose()}
}
async function businessScenario(){
 const runtime=ctx.get('bidBusiness');assert.ok(runtime);
 assert.ok((await ctx.agentPresets.list()).some(p=>p.id===presetId&&!p.broken));
 assert.ok((await runtime.ctx.agentPresets.list()).some(p=>p.id==='ooo-bidpliot-execution'&&!p.broken));
 assert.ok(!(await ctx.agentPresets.list()).some(p=>p.id==='ooo-bidpliot-execution'));
 assert.equal((await fetch(base+'/api/bidv4/tasks')).status,401);
 const assets=[];
 const representative=['client.js','renderer/figureRenderer.js','pdfjs/pdf.worker.min.mjs','pdfjs/cmaps/UniGB-UCS2-H.bcmap','pdfjs/standard_fonts/FoxitSerif.pfb',...(await readdir(join(installation,'dist/pdfjs/wasm'))).filter(n=>n.endsWith('.wasm')).slice(0,1).map(n=>'pdfjs/wasm/'+n)];
 for(const path of representative){const r=await fetch(base+'/api/bidv4/assets/'+path,{headers:{Cookie:cookie}});assert.equal(r.status,200,path);const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length);assert.equal(sha(bytes),sha(await readFile(join(installation,'dist',path))));assets.push({path,bytes:bytes.length,sha256:sha(bytes)});}
 const {task}=await api('/tasks',{title:'本地目录安装与数据保留验收',request_id:randomUUID()}),taskId=task.id;
 const company=await api('/library/companies',{name:'交付验收公司',profile:{legal_name:'验收法人',legal_title:'总经理',address:'验收地址',phone:'123',email:'fixture@example.test',fax:'无'}});
 await api('/projects/'+taskId+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-13',revision:0},'PUT');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64');
 const upload=new FormData();upload.set('file',new Blob([png],{type:'image/png'}),'交付验收原件.png');await api('/files?task_id='+taskId,upload);
 const sessions=[];
 for(const kind of ['analyse','outline','guide','promises','body','revise']){
  const state=await api('/page-flow/'+taskId),payload={kind,request_id:randomUUID(),input_version:state.input_versions[kind],...(kind==='outline'?{page_target:120,numbering:'decimal'}:{}),...(kind==='analyse'?{main_file:'交付验收原件.png',supplements:[]}:{}),...(['body','revise'].includes(kind)?{sections:state.body_sections}:{}),...(kind==='revise'?{instruction:'替换交付验收段落'}:{})};
  const admitted=await api('/page-flow/'+taskId+'/action',payload);sessions.push(admitted.session_id);
  await timeout(runtime.handles.get(admitted.session_id).agent.whenIdle(),kind);await runtime.settling.get(taskId);
  const result=await api('/page-flow/'+taskId);assert.equal(result.execution.state,'completed',JSON.stringify(result.execution));
  const errors=runtime.handles.get(admitted.session_id).agent.session.snapshotEvents().filter(e=>e.type==='tool/result'&&(e.data.message.isError||e.data.message.content.some(b=>b.type==='text'&&/^\[(发布失败|创建失败|修订失败|合册失败)\]/.test(b.text))));assert.deepEqual(errors,[],kind);
 }
 const state=await api('/page-flow/'+taskId);await api('/page-flow/'+taskId+'/export',{input_version:state.input_versions.revise});
 const artifacts=await api('/artifacts?task_id='+taskId),volume=artifacts.artifacts.find(a=>a.kind==='tender.volume');assert.ok(volume);
 const output=await fetch(base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file',{headers:{Cookie:cookie}});assert.equal(output.status,200);const bytes=Buffer.from(await output.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
 const docx=await api('/workbench/docx-view?task_id='+taskId+'&path='+encodeURIComponent('body/交付验收章节.docx'));assert.match(JSON.stringify(docx),/本地目录交付修订段落/);
 const agentSession='delivery-public-agent-'+randomUUID(),agent=await queryAgent(taskId,agentSession);
 assert.equal(agent.outputHash,sha(bytes));
 const businessSessions=Object.fromEntries(sessions.map(id=>[id,sessionEvidence(runtime.handles.get(id).agent.session.snapshotEvents())]));
 const buildTask=(await api('/tasks',{title:'本地目录完整制作及提问验收',request_id:randomUUID()})).task.id;
 await api('/projects/'+buildTask+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-13',revision:0},'PUT');
 const buildUpload=new FormData();buildUpload.set('file',new Blob([png],{type:'image/png'}),'交付验收原件.png');await api('/files?task_id='+buildTask,buildUpload);
 for(const kind of ['analyse','outline']){const s=await api('/page-flow/'+buildTask),r=await api('/page-flow/'+buildTask+'/action',{kind,request_id:randomUUID(),input_version:s.input_versions[kind],...(kind==='analyse'?{main_file:'交付验收原件.png',supplements:[]}:{page_target:null,numbering:'gov'})});await runtime.handles.get(r.session_id).agent.whenIdle();await runtime.settling.get(buildTask);assert.equal((await api('/page-flow/'+buildTask)).execution.state,'completed');}
 let buildState=await api('/page-flow/'+buildTask);const buildRun=await api('/page-flow/'+buildTask+'/action',{kind:'build',request_id:randomUUID(),input_version:buildState.input_versions.build,sections:[]});
 await runtime.handles.get(buildRun.session_id).agent.whenIdle();await runtime.settling.get(buildTask);buildState=await api('/page-flow/'+buildTask);assert.equal(buildState.execution.state,'needs_input');
 const question=buildState.execution.questions[0];assert.ok(question);
 await api('/page-flow/'+buildTask+'/answer',{session_id:buildRun.session_id,call_ids:[question.callId],batches:[{call_id:question.callId,answers:[{id:'term',selected:['三年']}]}]});
 await runtime.handles.get(buildRun.session_id).agent.whenIdle();await runtime.settling.get(buildTask);buildState=await api('/page-flow/'+buildTask);assert.equal(buildState.execution.state,'completed',JSON.stringify(buildState.execution));assert.equal(buildState.execution.session_id,buildRun.session_id);assert.equal(buildState.volume_states[0].status,'ready');
 const switchedAgent=await queryAgent(buildTask,agentSession,true);assert.equal(switchedAgent.taskId,buildTask);assert.deepEqual(switchedAgent.eventHashes.slice(0,agent.eventCount),agent.eventHashes,'Switching queried projects must preserve the prior Agent conversation');
 return {taskId,companyId:company.id,sessions,businessSessions,agentSession,agent,switchedAgent,assets,outputHash:sha(bytes),originalHash:sha(png),artifactId:volume.artifact_id,state:await api('/page-flow/'+taskId),build:{taskId:buildTask,sessionId:buildRun.session_id,sameSessionAnswer:true,state:buildState.execution.state,volume:buildState.volume_states[0].status},requests:requests.length};
}
async function verifyRetained(args){
 const state=await api('/page-flow/'+args.taskId);assert.equal(state.execution.state,'completed');assert.ok(state.body_files.includes('body/交付验收章节.docx'));assert.equal(state.files.filter(f=>f.path.startsWith('analysis/')).length,8);
 const r=await fetch(base+'/api/bidv4/artifacts/'+args.artifactId+'/file',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),args.outputHash);
 const source=await readFile(join(installation,'data/workspace',args.taskId,'sources/交付验收原件.png'));assert.equal(sha(source),args.originalHash);
 const runtime=ctx.get('bidBusiness'),records=[];
 for(const file of await readdir(join(installation,'data/actions',args.taskId))){if(file.endsWith('.json'))records.push(JSON.parse(await readFile(join(installation,'data/actions',args.taskId,file),'utf8')));}
 for(const id of args.sessions){
  const record=records.find(r=>r.session_id===id);assert.ok(record);const h=await runtime.handle(record),events=h.agent.session.snapshotEvents(),actual=sessionEvidence(events),expected=args.businessSessions[id];
  assert.deepEqual(actual.eventHashes.slice(0,expected.eventCount),expected.eventHashes,'Business history prefix must be preserved');assert.equal(actual.lastTurn,'completed');
  assert.ok(events.slice(expected.eventCount).every(e=>e.type==='session/end-seed'),'Only the official close marker may follow the completed business turn');
 }
 const agent=await queryAgent(args.taskId,args.agentSession,true);assert.ok(agent.eventCount>args.agent.eventCount);assert.equal(agent.outputHash,args.outputHash);
 assert.deepEqual(agent.eventHashes.slice(0,args.agent.eventCount),args.agent.eventHashes,'Independent Agent history prefix must be preserved');
 return {state,agent,originalHash:sha(source),outputHash:args.outputHash};
}
async function cancelScenario(args){
 blocking=true;const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId);
 const admitted=await api('/page-flow/'+args.taskId+'/action',{kind:'body',request_id:randomUUID(),input_version:state.input_versions.body,sections:state.body_sections});
 await timeout(blocked.promise,'blocked child');await api('/page-flow/'+args.taskId+'/stop',{session_id:admitted.session_id});await timeout(cancelled.promise,'cancelled child');
 assert.equal((await api('/page-flow/'+args.taskId)).execution.state,'stopped');assert.deepEqual(await readdir(join(installation,'data/locks')),[]);blocking=false;
 return {sessionId:admitted.session_id,state:'stopped',childCancelled:true};
}
let ending=false;
async function close(){
 if(ending)return;ending=true;
 const logs=ctx.logger.buffer,runtimeLogs=ctx.get('bidBusiness')?.ctx.logger.buffer;
 try{await ctx.fiber.dispose();}
 finally{endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));}
 const failures=[...(logs??[]),...(runtimeLogs??[])].filter(entry=>/closed handle|final drain.*failed|best-effort final session flush failed|unhandled rejection/i.test(entry.args.map(String).join(' '))).map(entry=>({name:entry.name,args:entry.args.map(String)}));
 assert.deepEqual(failures,[],'Session drain diagnostics must be clean');
}
process.on('message',async({id,command,args})=>{
 try{
  let result;
  if(command==='overview')result=await overview();
  else if(command==='business')result=await businessScenario();
  else if(command==='retained')result=await verifyRetained(args);
  else if(command==='agent')result=await queryAgent(args.taskId,args.sessionId??randomUUID(),args.resume);
  else if(command==='host')result=await hostProbe();
  else if(command==='cancel')result=await cancelScenario(args);
  else if(command==='route'){const response=await fetch(base+args.path,{headers:{Cookie:cookie}});result={status:response.status};}
  else if(command==='diagnostics')result=ctx.logger.buffer.filter(entry=>entry.level>=2||entry.args.some(a=>/ooo-bidpliot|准备|依赖|ENOENT|dist|busboy|python|docx/i.test(String(a)))).map(entry=>({name:entry.name,args:entry.args.map(String)}));
  else if(command==='close'){await close();send({id,result:{closed:true}});process.disconnect();return;}
  else throw Error('Unknown fixture command: '+command);
  send({id,result});
 }catch(error){send({id,error:{message:error.message,stack:error.stack}})}
});
process.on('SIGTERM',()=>close().then(()=>process.exit(0)));
send({ready:true,result:await overview()});
