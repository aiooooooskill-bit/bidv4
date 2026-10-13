import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {root,dataRoot,business} from '../server/native/business.mjs';

const testName='完整官方Web插件：六阶段HTTP执行、卸载取消子Agent、宿主存活与重新加载';
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const directory={response_documents:[{name:' 工程验证册 ',directory:[{目录名称:'工程验证章节',level:1,children:[]}]}]};
const bounded=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(label+' timed out')),10000);timer.unref()})]);

if(process.env.BIDV4_WEB_FIXTURE!=='1')test('完整插件回归只使用临时应用与官方Web配置',{timeout:100000},()=>runIsolatedTest('plugin-lifecycle.test.mjs','BIDV4_WEB_FIXTURE',new RegExp(testName),90000));
else test(testName,{timeout:80000},async()=>{
 let ctx,blockChild=false,missingArtifacts=false,skipValidation=false;
 const started=Promise.withResolvers(),cancelled=Promise.withResolvers(),requests=[];
 const call=(name,args)=>({name,args});
 const endpoint=createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const request=JSON.parse(raw);requests.push(request);
   const text=request.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   if(text.includes('web-cancel-child-fixture')){
    res.write(': waiting for cancellation\n\n');res.once('close',()=>cancelled.resolve());started.resolve();return;
   }
   const payload=text.match(/页面输入：(\{[^\n]+\})/),kind=payload?JSON.parse(payload[1]).kind:null;
   const cwd=text.match(/当前任务绝对路径：([^；]+)；/)?.[1];
   const step=request.messages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).length;
   const write=(path,content)=>call('write',{file_path:join(cwd,'work',path),content});
   let calls=[];
   if(text.includes('web-body-child-fixture')){
    if(step===0)calls=[call('docx_section_create',{path:'body/工程验证章节.docx',title:'工程验证章节',paragraphs:'工程验证原段落'})];if(step===1)calls=[call('validate_body',{section:'body/工程验证章节.docx'})];
   }else if(!missingArtifacts){
    if(kind==='analyse'&&step===0)calls=analysis.map(n=>write('analysis/'+n+'.md','# 工程夹具 '+n+'\n仅验证工具执行与文件落盘。'));
    if(kind==='outline')calls=step===0?[call('write',{file_path:join(cwd,'_meta/staging/tender-response-docs.json'),content:JSON.stringify(directory)})]:step===1?[call('publish_artifact',{contract:'tender.directory/tender-response-docs@1',draft_path:join(cwd,'_meta/staging/tender-response-docs.json')})]:[];
    if(kind==='guide'&&step===0)calls=[write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 工程验证章节 | 推理撰写 | — | — | 无 |')];
    if(kind==='promises'&&step===0)calls=[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |')];
    if(kind==='build'){
     const replied=text.includes('answer_to_pending_question');
     const sequence=[
      [call('build_preparation',{})],
      [write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 工程验证章节 | 推理撰写 | — | — | 无 |')],
      [call('validate_body',{section:'body/写作指引.md'})],
      [call('build_preparation',{stage:'guide'})],
      [call('ask_user_question',{questions:[{id:'term',question:'维护期是多少？',options:[{label:'三年'},{label:'五年'}]}]})],
      replied?[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |')]:[],
      [call('build_preparation',{stage:'promises'})],
      [call('task',{subagent_type:'tender-body-writer',description:'web-body-child-fixture'})],
      [call('check_pipeline_state',{}),call('validate_body',{section:'body'}),call('docx_assemble_volume',{})],
     ];calls=sequence[step]??[];
    }
    if(kind==='body')calls=step===0?[call('task',{subagent_type:'tender-body-writer',description:blockChild?'web-cancel-child-fixture':'web-body-child-fixture'})]:step===1?[call('check_pipeline_state',{}),call('validate_body',{section:'body'})]:[];
    if(kind==='revise')calls=step===0?[call('docx_section_revise',{path:'body/工程验证章节.docx',edits:JSON.stringify([{para:2,action:'replace',find:'工程验证原段落',text:'工程验证修订段落'}])})]:step===1&&!skipValidation?[call('validate_body',{section:'body/工程验证章节.docx'})]:[];
   }
   const delta=calls.length?{tool_calls:calls.map((c,index)=>({index,id:'fixture-'+step+'-'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'工程夹具执行结束'};
   for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
   res.end('data: [DONE]\n\n');
  }catch(error){res.destroy(error)}
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 try{
  const profile=join(process.env.DSH_HOME,'profiles','web');await mkdir(join(profile,'node_modules'),{recursive:true});
  await symlink(root,join(profile,'node_modules','ooo-bidpliot'),'dir');
  await symlink(join(root,'node_modules','@deepseek-ai'),join(profile,'node_modules','@deepseek-ai'),'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
   {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
   {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BIDV4_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
   {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
   {id:'session-title-llm',disabled:true},
  ]));
  process.env.BIDV4_FIXTURE_KEY='local-test-only';
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  const runtime=ctx.get('bidBusiness');assert.ok(runtime,'Plugin entry must provide its business runtime');
  assert.notEqual(runtime.ctx.events,ctx.events);
  assert.ok((await runtime.ctx.agentPresets.list()).some(p=>p.id==='ooo-bidpliot-execution'&&!p.broken));
  const displayPreset=(await ctx.agentPresets.list()).find(p=>p.id==='ooo-bidpliot');
  assert.ok(displayPreset&&!displayPreset.broken,JSON.stringify(displayPreset));
  const hostTools=ctx.get('tools'),defaultPreset=ctx.agentPresets.defaultId,model={provider:'fixture',model:'fixture'};
  let probeCalls=0;
  const removeProbe=hostTools.register({name:'bid_fixture_write',description:'Host write capability probe',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(){probeCalls++;return 'host write probe'}});
  const displaySetup=async c=>{await ctx.agentPresets.mount(c,'ooo-bidpliot')};
  const hostAgent=await ctx.agents.create({sessionId:'display-unrelated-host',meta:{cwd:root,agentPreset:defaultPreset},agentOptions:model,setup:async c=>{await ctx.agentPresets.mount(c,defaultPreset)}});
  const assertDisplay=async agent=>{
   assert.deepEqual(hostTools.schemas(agent).map(t=>t.name),['ooo_bidpliot_status']);
   const status=await hostTools.execute({callId:randomUUID(),name:'ooo_bidpliot_status',arguments:{},agent,signal:AbortSignal.timeout(10000)});
   assert.equal(status.isError,false,JSON.stringify(status));assert.deepEqual(JSON.parse(status.value),{tasks:[]});
   const denied=await hostTools.execute({callId:randomUUID(),name:'bid_fixture_write',arguments:{},agent,signal:AbortSignal.timeout(10000)});
   assert.equal(denied.isError,true);assert.equal(denied.error.info.code,'UNKNOWN_TOOL');assert.equal(probeCalls,0);
  };
  try{
   assert.ok(hostTools.get('bid_fixture_write',hostAgent.agent));assert.equal(hostTools.get('ooo_bidpliot_status',hostAgent.agent),undefined);
   const displayAgent=await ctx.agents.create({sessionId:'display-preset-mount',meta:{cwd:root,agentPreset:'ooo-bidpliot'},agentOptions:model,setup:displaySetup});
   try{await assertDisplay(displayAgent.agent);assert.ok(hostTools.get('bid_fixture_write',hostAgent.agent))}finally{await displayAgent.dispose()}
   const resumedDisplay=await ctx.agents.resume({resumeSessionId:'display-preset-mount',agentOptions:model,setup:displaySetup});
   try{await assertDisplay(resumedDisplay.agent)}finally{await resumedDisplay.dispose()}
   await ctx.agentPresets.select(hostAgent.agent,'ooo-bidpliot');await assertDisplay(hostAgent.agent);
   await ctx.agentPresets.select(hostAgent.agent,defaultPreset);
   assert.ok(hostTools.get('bid_fixture_write',hostAgent.agent));assert.equal(hostTools.get('ooo_bidpliot_status',hostAgent.agent),undefined);
   assert.equal(requests.length,0,'Preset create/resume/select and status reads must not request a model');
  }finally{await hostAgent.dispose();removeProbe()}
  const entry=[...ctx.loader.entries()].find(e=>e.options.id==='ooo-bidpliot');assert.ok(entry?.fiber);
  const base='http://127.0.0.1:'+ctx.webServer.port;
  const login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'});
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');assert.ok(cookie);
  async function api(path,body,method=body?'POST':'GET'){
   const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;
  }
  assert.equal((await fetch(base+'/api/bidv4/tasks')).status,401);
  assert.deepEqual((await api('/tasks')).tasks,[]);
  const {task}=await api('/tasks',{title:'完整Web工程回归',request_id:randomUUID()}),tid=task.id;
  const company=await api('/library/companies',{name:'工程公司',profile:{legal_name:'工程法人',legal_title:'总经理',address:'工程地址',phone:'123',email:'bid@example.test',fax:'无'}});
  await api('/projects/'+tid+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-12',revision:0},'PUT');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64');
  const upload=new FormData();upload.set('file',new Blob([png],{type:'image/png'}),'工程源.png');await api('/files?task_id='+tid,upload);
  // Source-save HTTP route must use the same admission as action submission.
  const supplement=new FormData();supplement.set('file',new Blob([png],{type:'image/png'}),'补充.png');await api('/files?task_id='+tid,supplement);
  const initial=await api('/page-flow/'+tid),entered=Promise.withResolvers(),release=Promise.withResolvers();
  const stateReader=runtime.state.bind(runtime);let pause=true;
  runtime.state=async id=>{const value=await stateReader(id);if(pause&&id===tid){pause=false;entered.resolve();await release.promise}return value};
  const selection={main_file:'工程源.png',supplements:['补充.png'],input_version:initial.input_versions.analyse};
  const saving=api('/page-flow/'+tid+'/sources',selection,'PUT');
  const rejectRequest=async(path,body,method)=>{const result=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(result.status,409);return result.json()};
  try{
   await bounded(entered.promise,'source save admission');
   await rejectRequest('/page-flow/'+tid+'/sources',{...selection,main_file:'补充.png',supplements:[]},'PUT');
   await rejectRequest('/page-flow/'+tid+'/action',{kind:'analyse',request_id:randomUUID(),input_version:selection.input_version},'POST');
   release.resolve();const saved=await saving;assert.equal(saved.source_selection.supplements[0].file,'补充.png');assert.notEqual(saved.input_versions.analyse,selection.input_version);
   await rejectRequest('/page-flow/'+tid+'/sources',{...selection,main_file:'补充.png',supplements:[]},'PUT');
   assert.equal((await api('/page-flow/'+tid)).source_selection.main,'工程源.png');assert.equal(runtime.admissions.size,0);
  }finally{release.resolve();await saving;runtime.state=stateReader}
  const source=join(dataRoot,'workspace',tid,'sources','工程源.png'),sourceHash=createHash('sha256').update(await readFile(source)).digest('hex');
  let hostLeaks=0;const detach=ctx.on('agent/pre-step',(_payload,next)=>{hostLeaks++;return next()},{global:true});
  const sessions=[];
  for(const kind of ['analyse','outline','guide','promises','body','revise']){
   const state=await api('/page-flow/'+tid);
   const payload={kind,request_id:randomUUID(),input_version:state.input_versions[kind],...(kind==='outline'?{page_target:120,numbering:'decimal'}:{}),...(kind==='analyse'?{main_file:'工程源.png',supplements:[]}:{}),...(['body','revise'].includes(kind)?{sections:state.body_sections}:{}),...(kind==='revise'?{instruction:'替换工程段落'}:{})};
   const admitted=await api('/page-flow/'+tid+'/action',payload);sessions.push(admitted.session_id);
   await bounded(runtime.handles.get(admitted.session_id).agent.whenIdle(),kind);await runtime.settling.get(tid);
   const result=await api('/page-flow/'+tid);assert.equal(result.execution.state,'completed',JSON.stringify({execution:result.execution,tools:runtime.handles.get(admitted.session_id).agent.session.snapshotEvents().filter(e=>e.type==='tool/result').map(e=>e.data)}));
   const errors=runtime.handles.get(admitted.session_id).agent.session.snapshotEvents().filter(e=>e.type==='tool/result'&&(e.data.message.isError||e.data.message.content.some(b=>b.type==='text'&&/^\[(发布失败|创建失败|修订失败|合册失败)\]/.test(b.text))));assert.deepEqual(errors,[],kind);
  }
  // 整本制作从无规划开始，实际走官方提问、页面回答与同会话续接。
  const buildTask=await api('/tasks',{title:'自动制作链路验证',request_id:randomUUID()}),buildId=buildTask.task.id;
  await api('/projects/'+buildId+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-12',revision:0},'PUT');
  const buildUpload=new FormData();buildUpload.set('file',new Blob([png],{type:'image/png'}),'工程源.png');await api('/files?task_id='+buildId,buildUpload);
  for(const kind of ['analyse','outline']){
   const current=await api('/page-flow/'+buildId);
   const result=await api('/page-flow/'+buildId+'/action',{kind,request_id:randomUUID(),input_version:current.input_versions[kind],...(kind==='analyse'?{main_file:'工程源.png',supplements:[]}:{page_target:null,numbering:'gov'})});
   await runtime.handles.get(result.session_id).agent.whenIdle();await runtime.settling.get(buildId);
  }
  let buildState=await api('/page-flow/'+buildId);assert.equal(buildState.directory.content.page_target,null);assert.equal(buildState.directory.content.numbering,'gov');
  const buildPayload={kind:'build',request_id:randomUUID(),input_version:buildState.input_versions.build,sections:[]};
  const buildRun=await api('/page-flow/'+buildId+'/action',buildPayload);
  await runtime.handles.get(buildRun.session_id).agent.whenIdle();await runtime.settling.get(buildId);
  buildState=await api('/page-flow/'+buildId);assert.equal(buildState.execution.state,'needs_input');assert.equal(buildState.build_preparation.guide,'ready');assert.equal(buildState.build_preparation.promises,'missing');assert.equal(buildState.body_files.length,0);
  assert.deepEqual(await api('/page-flow/'+buildId+'/action',buildPayload),{session_id:buildRun.session_id,replayed:true});
  const question=buildState.execution.questions[0];
  await api('/page-flow/'+buildId+'/answer',{session_id:buildRun.session_id,call_ids:[question.callId],batches:[{call_id:question.callId,answers:[{id:'term',selected:['三年']}]}]});
  await runtime.handles.get(buildRun.session_id).agent.whenIdle();await runtime.settling.get(buildId);
  buildState=await api('/page-flow/'+buildId);assert.equal(buildState.execution.state,'completed',JSON.stringify(buildState.execution));assert.equal(buildState.execution.session_id,buildRun.session_id);assert.deepEqual(buildState.build_preparation,{guide:'ready',promises:'ready'});assert.equal(buildState.body_sections[0].status,'ready');assert.equal(buildState.body_files.filter(p=>!p.includes('整本-')).length,1);
  const finalArtifacts=await api('/artifacts?task_id='+buildId),volume=finalArtifacts.artifacts.find(a=>a.kind==='tender.volume');assert.ok(volume);
  const volumeResponse=await fetch(base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file',{headers:{Cookie:cookie}});assert.equal(volumeResponse.status,200);const publishedBytes=Buffer.from(await volumeResponse.arrayBuffer());assert.equal(publishedBytes.subarray(0,2).toString(),'PK');
  assert.equal(buildState.volume_states[0].status,'ready');assert.equal(buildState.volume_states[0].name,'工程验证册');assert.equal(buildState.body_sections[0].volume,'工程验证册');
  const statusAgent=await ctx.agents.create({sessionId:'display-page-results',meta:{cwd:root,agentPreset:'ooo-bidpliot'},agentOptions:model,setup:displaySetup});
  try{
   const before=requests.length;
   const status=async task_id=>{const result=await hostTools.execute({callId:randomUUID(),name:'ooo_bidpliot_status',arguments:{task_id},agent:statusAgent.agent,signal:AbortSignal.timeout(10000)});assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.value)};
   const projectStatus=await status(tid);assert.equal(projectStatus.task_id,tid);assert.equal(projectStatus.execution.state,'completed');assert.equal(projectStatus.execution.session_id,sessions.at(-1));
   const analysisDocument=projectStatus.documents.find(d=>d.name==='structure.md');assert.ok(analysisDocument);assert.equal(new URL(analysisDocument.link).origin,base);const documentResponse=await fetch(analysisDocument.link,{headers:{Cookie:cookie}});assert.equal(documentResponse.status,200);assert.match((await documentResponse.json()).content,/工程夹具 structure/);
   const volumeStatus=await status(buildId);assert.equal(volumeStatus.task_id,buildId);assert.equal(volumeStatus.execution.state,'completed');
   const output=volumeStatus.outputs.find(o=>o.link===base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file');assert.equal(output.name,'工程验证册');
   const outputResponse=await fetch(output.link,{headers:{Cookie:cookie}});assert.equal(outputResponse.status,200);assert.deepEqual(Buffer.from(await outputResponse.arrayBuffer()),publishedBytes);
   assert.equal(requests.length,before,'Independent status Agent must read page results without requesting a model');
  }finally{await statusAgent.dispose()}
  // 当前目录新增必需正文：HTTP导出拒绝缺章，旧发布包保持完整。
  const originalDirectory=structuredClone(buildState.directory.content),partialDirectory=structuredClone(originalDirectory);
  partialDirectory.response_documents[0].directory.push({目录名称:'保障缺失章节',level:1,children:[]});
  await api('/artifacts/'+buildState.directory.artifact_id+'/content',{content:partialDirectory,base_content_seq:buildState.directory.content_seq},'PUT');
  const partialState=await api('/page-flow/'+buildId);
  const partialExport=await fetch(base+'/api/bidv4/page-flow/'+buildId+'/export',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({input_version:partialState.input_versions.revise})});
  assert.equal(partialExport.status,422);assert.match((await partialExport.json()).detail,/整册未完成生成或发布/);
  const retained=(await api('/artifacts?task_id='+buildId)).artifacts.find(a=>a.artifact_id===volume.artifact_id);assert.equal(retained.content_seq,volume.content_seq);
  const retainedDownload=await fetch(base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file',{headers:{Cookie:cookie}});assert.deepEqual(Buffer.from(await retainedDownload.arrayBuffer()),publishedBytes);
  const afterPartial=await api('/page-flow/'+buildId);assert.equal(afterPartial.volume_states[0].status,'stale');
  await api('/artifacts/'+buildState.directory.artifact_id+'/content',{content:originalDirectory,base_content_seq:afterPartial.directory.content_seq},'PUT');
  const restored=await api('/page-flow/'+buildId);await api('/page-flow/'+buildId+'/export',{input_version:restored.input_versions.revise});
  buildState=await api('/page-flow/'+buildId);assert.equal(buildState.volume_states[0].status,'ready');
  // 修订写入后未校验：HTTP导出拒绝，发布包和版本不变；实际校验后才发布新正文。
  const beforeDraft=(await api('/artifacts?task_id='+buildId)).artifacts.find(a=>a.artifact_id===volume.artifact_id);
  const beforeDraftDownload=await fetch(base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file',{headers:{Cookie:cookie}});
  const beforeDraftBytes=Buffer.from(await beforeDraftDownload.arrayBuffer());
  skipValidation=true;
  try{
   const draftRun=await api('/page-flow/'+buildId+'/action',{kind:'revise',request_id:randomUUID(),input_version:buildState.input_versions.revise,sections:buildState.body_sections,instruction:'替换正文后暂不校验'});
   await runtime.handles.get(draftRun.session_id).agent.whenIdle();await runtime.settling.get(buildId);
  }finally{skipValidation=false}
  const draftState=await api('/page-flow/'+buildId);assert.equal(draftState.body_sections[0].status,'draft');assert.equal(draftState.execution.state,'failed');
  const draftExport=await fetch(base+'/api/bidv4/page-flow/'+buildId+'/export',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({input_version:draftState.input_versions.revise})});
  assert.equal(draftExport.status,422);
  const afterDraft=(await api('/artifacts?task_id='+buildId)).artifacts.find(a=>a.artifact_id===volume.artifact_id);assert.equal(afterDraft.content_seq,beforeDraft.content_seq);
  const afterDraftDownload=await fetch(base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file',{headers:{Cookie:cookie}});assert.deepEqual(Buffer.from(await afterDraftDownload.arrayBuffer()),beforeDraftBytes);
  const validation=await business(runtime.ctx,'tool',{name:'validate_body',parameters:{section:'body/工程验证章节.docx'}},{taskId:buildId});assert.match(validation,/^\[校验通过\]/);
  const validated=await api('/page-flow/'+buildId);assert.equal(validated.body_sections[0].status,'ready');
  await api('/page-flow/'+buildId+'/export',{input_version:validated.input_versions.revise});
  const afterValidation=(await api('/artifacts?task_id='+buildId)).artifacts.find(a=>a.artifact_id===volume.artifact_id);assert.equal(afterValidation.content_seq,beforeDraft.content_seq+1);
  const mergedRevision=await api('/workbench/docx-view?task_id='+buildId+'&path='+encodeURIComponent('body/整本-工程验证册.docx'));assert.ok(JSON.stringify(mergedRevision).includes('工程验证修订段落'));
  buildState=await api('/page-flow/'+buildId);assert.equal(buildState.volume_states[0].status,'ready');
  // 正文与规划齐全，但当前整册文件缺失，模型只结束会话不得报制作成功。
  const {unlink}=await import('node:fs/promises');
  await unlink(join(dataRoot,'workspace',buildId,'work/body/整本-工程验证册.docx'));
  const noVolumeState=await api('/page-flow/'+buildId);assert.equal(noVolumeState.volume_states[0].status,'missing');
  missingArtifacts=true;
  const noVolumeRun=await api('/page-flow/'+buildId+'/action',{kind:'build',request_id:randomUUID(),input_version:noVolumeState.input_versions.build,sections:[]});
  await runtime.handles.get(noVolumeRun.session_id).agent.whenIdle();await runtime.settling.get(buildId);
  const noVolumeResult=await api('/page-flow/'+buildId);assert.equal(noVolumeResult.execution.state,'failed');assert.match(noVolumeResult.execution.error,/整册未完成生成或发布/);
  missingArtifacts=false;
  await api('/page-flow/'+buildId+'/export',{input_version:noVolumeResult.input_versions.revise});
  buildState=await api('/page-flow/'+buildId);assert.equal(buildState.volume_states[0].status,'ready');
  const originalBody=await readFile(join(dataRoot,'workspace',buildId,'work/body/工程验证章节.docx'));
  const renamed={...buildState.directory.content,response_documents:[{name:'工程验证册',directory:[{目录名称:'新版章节',level:1,children:[]}]}]};
  await api('/artifacts/'+buildState.directory.artifact_id+'/content',{content:renamed,base_content_seq:buildState.directory.content_seq},'PUT');
  const afterDirectoryEdit=await api('/page-flow/'+buildId);assert.equal(afterDirectoryEdit.body_sections[0].status,'missing');assert.deepEqual(afterDirectoryEdit.orphan_body_files,['body/工程验证章节.docx']);assert.deepEqual(await readFile(join(dataRoot,'workspace',buildId,'work/body/工程验证章节.docx')),originalBody);
  // 有旧正文不代表新版目录已完成；模型空转必须失败。
  missingArtifacts=true;
  await rejectRequest('/page-flow/'+buildId+'/action',{kind:'build',request_id:randomUUID(),input_version:afterDirectoryEdit.input_versions.build,sections:[]},'POST');
  assert.equal((await api('/page-flow/'+buildId)).body_sections[0].status,'missing');missingArtifacts=false;
  assert.equal(hostLeaks,0);detach();
  const state=await api('/page-flow/'+tid);assert.ok(state.body_files.includes('body/工程验证章节.docx'));assert.equal(state.files.filter(f=>f.path.startsWith('analysis/')).length,8);
  const docx=await api('/workbench/docx-view?task_id='+tid+'&path='+encodeURIComponent('body/工程验证章节.docx'));assert.ok(JSON.stringify(docx).includes('工程验证修订段落'));
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),sourceHash);
  assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);
  missingArtifacts=true;
  const empty=await api('/tasks',{title:'空成果拒绝回归',request_id:randomUUID()}),emptyId=empty.task.id;
  const emptyUpload=new FormData();emptyUpload.set('file',new Blob([png],{type:'image/png'}),'工程源.png');await api('/files?task_id='+emptyId,emptyUpload);
  const emptyState=await api('/page-flow/'+emptyId),emptyRun=await api('/page-flow/'+emptyId+'/action',{kind:'analyse',request_id:randomUUID(),input_version:emptyState.input_versions.analyse,main_file:'工程源.png',supplements:[]});
  await runtime.handles.get(emptyRun.session_id).agent.whenIdle();await runtime.settling.get(emptyId);
  const failed=await api('/page-flow/'+emptyId);assert.equal(failed.execution.state,'failed');assert.match(failed.execution.error,/未产出所需文件/);missingArtifacts=false;
  blockChild=true;
  const current=await api('/page-flow/'+tid);await api('/page-flow/'+tid+'/action',{kind:'body',request_id:randomUUID(),input_version:current.input_versions.body,sections:current.body_sections});
  await bounded(started.promise,'Child request');
  const stopping=await api('/page-flow/'+tid);
  await api('/page-flow/'+tid+'/stop',{session_id:stopping.execution.session_id});
  assert.equal((await api('/page-flow/'+tid)).execution.state,'stopped');
  assert.ok(runtime.handles.get(stopping.execution.session_id).agent.session.snapshotEvents().every(e=>e.type!=='bid/action-stop'));
  await entry.update({disabled:true});await ctx.loader.await();await bounded(cancelled.promise,'Child cancellation');
  assert.equal(runtime.handles.size,0);assert.equal(runtime.settling.size,0);assert.equal(ctx.get('bidBusiness'),undefined);assert.deepEqual(await readdir(join(dataRoot,'locks')),[]);
  assert.equal((await fetch(base+'/api/bidv4/tasks',{headers:{Cookie:cookie}})).status,404);
  const host=await ctx.agents.create({sessionId:'host-after-plugin-unload',meta:{cwd:root},agentOptions:{provider:'fixture',model:'fixture'}});
  try{host.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Host remains usable'}]}));await host.agent.whenIdle();assert.equal(host.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed')}finally{await host.dispose()}
  await entry.update({disabled:false});await ctx.loader.await();
  assert.ok(ctx.get('bidBusiness'));assert.notEqual(ctx.get('bidBusiness'),runtime);
  assert.equal((await api('/tasks')).tasks.length,3);
  const recovered=await api('/page-flow/'+tid);assert.deepEqual(recovered.body_files.sort(),state.body_files.sort());assert.equal(recovered.execution.state,'stopped');
  assert.ok(requests.length>6);assert.equal(sessions.length,6);
 }finally{
  await ctx?.fiber.dispose();endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
 }
});
