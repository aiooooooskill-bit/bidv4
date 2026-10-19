import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {json as readJson} from 'node:stream/consumers';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,basename} from 'node:path';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {reviewSequence} from './review-sequence.mjs';

// This driver imports the official runtime from the freshly prepared installation.
// It never changes a production profile or calls a remote model provider.
const installation=process.env.BID_DELIVERY_INSTALL;
assert.ok(installation,'BID_DELIVERY_INSTALL is required');
const requireInstalled=createRequire(join(installation,'package.json'));
const installed=name=>import(pathToFileURL(requireInstalled.resolve(name)).href);
const {loadLayeredEnv}=await installed('@deepseek-ai/dsh-app-boot');
const {runProfile}=await installed('@deepseek-ai/dsh/profile-boot');
const {createUserMessage}=await installed('@deepseek-ai/dsh-llm');
const {chatToolNames}=await import(pathToFileURL(join(installation,'server/agent.mjs')).href);
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const directory={response_documents:[{name:'本地目录验收册',directory:[{目录名称:'交付验收章节',level:1,children:[]}]}]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sessionEvidence=events=>({eventCount:events.length,eventHashes:events.map(e=>sha(JSON.stringify(e))),lastTurn:events.findLast(e=>e.type==='turn/end')?.data.reason.kind});
const call=(name,args)=>({name,args});
const requests=[],fixtureErrors=[];const reviewCalls=reviewSequence(installation);
let blocking=false,hostContext,analysisGate,analysisTask,reviewEarlyEnd='normal';
const pausedReviews=new Set();
let analysisStreaming=false,crashAfterBody=false,reuseBuild=false,repeatBuildQuestion=false;
const crashBlocked=Promise.withResolvers();
const blocked=Promise.withResolvers(),cancelled=Promise.withResolvers();
const endpoint=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/login'&&hostContext){res.writeHead(302,{Location:hostContext.connection.authenticatedUrl('http://127.0.0.1:'+hostContext.webServer.port)});res.end();return;}
  const request=await readJson(req);requests.push({tools:request.tools?.map(t=>t.function?.name??t.name),model:request.model});
  const text=request.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const latestUser=request.messages.findLast(m=>m.role==='user'),latestText=typeof latestUser?.content==='string'?latestUser.content:JSON.stringify(latestUser?.content??[]);
  const instructionOf=m=>{if(m.role==='user')return typeof m.content==='string'?m.content:JSON.stringify(m.content);if(m.role==='tool'){try{return JSON.parse(m.content).instructions??''}catch{}}return ''};
  const stageAnchor=request.messages.findLastIndex(m=>instructionOf(m).includes('页面输入：'));
  const stageText=stageAnchor>=0?instructionOf(request.messages[stageAnchor]):'';
  const payload=stageText.match(/页面输入：(\{[^\n]+\})/),kind=payload&&!latestText.includes('查询项目进度')?JSON.parse(payload[1]).kind:null;
  const recordedCwd=stageText.match(/当前任务绝对路径：([^；]+)；/)?.[1];
  // A restored fixture keeps its original event bytes. Follow the current
  // bid-project context's root when its historical prompt came from another installation.
  const cwd=recordedCwd?join(installation,'data/workspace',basename(recordedCwd)):undefined;
  const stageMessages=kind?request.messages.slice(stageAnchor):request.messages;
  const step=stageMessages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).length;
  const write=(path,content)=>call('write',{file_path:join(cwd,'work',path),content});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(text.includes('delivery-cancel-child')){
   res.write(': waiting for cancellation\n\n');res.once('close',()=>cancelled.resolve());blocked.resolve();return;
  }
  let calls=[],content='本地目录验收执行完成。';
  const statusTools=request.tools?.filter(t=>(t.function?.name??t.name)==='ooo_bidpliot_status')??[];
  if(!kind&&statusTools.length&&text.includes('对话全流程验收')){
   const values=request.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(String(m.content)));
   const tid=values[1]?.task?.id;
   const sequence=[
    [call('ooo_bidpliot_project',{operation:'attachments'})],
    [call('ooo_bidpliot_project',{operation:'create',title:'对话全流程验收'})],
    [call('ooo_bidpliot_project',{operation:'import',task_id:tid,files:[{attachment_id:values[0]?.attachments?.[0]?.attachmentId}]})],
    [call('ooo_bidpliot_project',{operation:'sources',task_id:tid,main_file:'交付验收原件.png',supplements:[]})],
    [call('ooo_bidpliot_project',{operation:'company',company:{name:'对话验收公司',profile:{legal_name:'验收法人',legal_title:'总经理',address:'验收地址',phone:'123',email:'fixture@example.test',fax:'无'}}})],
    [call('ooo_bidpliot_project',{operation:'bidder',task_id:tid,company_id:values[4]?.id,signer_id:'legal',sign_date:'2026-10-15'})],
    [call('ooo_bidpliot_run',{task_id:tid,kind:'full'})],
   ];
   if(step<sequence.length)calls=sequence[step];
   else if(step===7&&latestText.includes('继续'))calls=[call('ooo_bidpliot_answer',{task_id:tid,batches:values[6].execution.questions.map(q=>({call_id:q.callId,answers:q.questions.map(question=>({id:question.id,selected:['三年']}))}))})];
   else if(step===8)calls=[call('ooo_bidpliot_read',{task_id:tid,report:true})];
   else if(step===7)content='需要补充具体信息：'+values[6].execution.questions.flatMap(q=>q.questions.map(v=>v.question)).join('；');
   else content='# 制作与审查已完成\n\n'+values[8].report.report.summary_items.join('\n')+'\n\n'+values[7].outputs.map(o=>'- ['+o.name+'下载]('+o.link+')').join('\n');
  }else if(!kind&&statusTools.length&&text.includes('对话上传验收')){
   const values=request.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(String(m.content)));
   const tid=values[1]?.task?.id;
   const sequence=[
    [call('ooo_bidpliot_project',{operation:'attachments'})],
    [call('ooo_bidpliot_project',{operation:'create',title:'对话上传验收'})],
    [call('ooo_bidpliot_project',{operation:'import',task_id:tid,files:[{attachment_id:values[0]?.attachments?.[0]?.attachmentId}]})],
    [call('ooo_bidpliot_project',{operation:'sources',task_id:tid,main_file:'交付验收原件.png',supplements:[]})],
    [call('ooo_bidpliot_run',{task_id:tid,kind:'analyse'})],
    [call('ooo_bidpliot_read',{task_id:tid,path:'analysis/structure.md'})],
   ];calls=sequence[step]??[];
   if(!calls.length)content='# 招标文件解读完成\n\n'+values.at(-1)?.content+'\n\n'+(values[4]?.documents??[]).map(d=>'- ['+d.name+']('+d.link+')').join('\n');
  }else if(!kind&&statusTools.length){
   const lastTool=request.messages.findLast(m=>m.role==='tool');
   // A real host Agent loop selects the tool, executes it, then writes the reply.
   if(request.messages.at(-1)?.role!=='tool'){const taskId=[...text.matchAll(/task_id=([a-zA-Z0-9_-]+)/g)].at(-1)?.[1];calls=[call('ooo_bidpliot_status',taskId?{task_id:taskId}:{})];}
   else{
    const status=JSON.parse(String(lastTool.content));
    content=status.tasks?'招投标工作台项目：\n'+status.tasks.map(t=>'- '+t.title+'（task_id='+t.id+'）').join('\n'):
     '项目 '+status.task_id+' 当前执行状态：'+status.execution?.state+'。\n\n'+status.outputs.map(o=>'- ['+o.name+'下载]('+o.link+')').join('\n')+'\n\n'+status.documents.map(d=>'- ['+d.name+']('+d.link+')').join('\n');
   }
  }else if(text.includes('调用read_image读取图片：')){
   if(step===0)calls=[call('read_image',{file_path:text.match(/调用read_image读取图片：(.+?)。/)?.[1]})];
   else content='# 招标资料转写\n项目名称：本地目录安装与数据保留验收\n维护期：三年。\n采购内容为信息系统建设、上线培训及后续维护。投标人应提供清晰的项目实施安排、人员职责、交付文件和验收方法。投标文件须包含响应目录、实施方案、技术措施、质量管理和服务保障。所有原始附件应完整保存，生成的正文与整册文件应可查询、预览及下载。本文是确定性本机验收夹具的模拟招标材料，不代表实际采购项目。';
  }else if(text.includes('delivery-resume-body-child')){
   if(step===0)calls=[call('validate_body',{section:'body/交付验收章节.docx'})];
  }else if(text.includes('delivery-body-child')){
   if(crashAfterBody&&step===1){res.write(': checkpoint after durable body write\n\n');crashBlocked.resolve();return;}
   if(step===0)calls=[call('docx_section_create',{path:'body/交付验收章节.docx',title:'交付验收章节',paragraphs:'本地目录交付原段落。'+('本文件为本机工程验收的合成投标正文，演示项目实施安排、职责、交付、验收及维护支持；具体履约指标须由真实材料和用户确认后补充。'.repeat(3))})];
   if(step===1)calls=[call('validate_body',{section:'body/交付验收章节.docx'})];
  }else if(kind==='review'){
   let last;try{last=JSON.parse(stageMessages.findLast(m=>m.role==='tool')?.content)}catch{}
   if(reviewEarlyEnd==='error'&&last?.saved&&!pausedReviews.has(cwd)){pausedReviews.add(cwd);res.end('data: {invalid-json}\n\n');return}
   if((reviewEarlyEnd==='progress'&&last?.saved&&!pausedReviews.has(cwd))||(reviewEarlyEnd==='none'&&step>=5)){pausedReviews.add(cwd);calls=[]}
   else calls=await reviewCalls({...request,messages:stageMessages},cwd,step);
  }else{
   if(kind==='analyse'&&step===0)calls=[call('parse_document',{file_name:'交付验收原件.png'})];
   if(kind==='analyse'&&step===1)calls=analysis.map(n=>write('analysis/'+n+'.md','# 本地目录验收 '+n+'\n固定目录安装、更新、重装使用的真实业务成果。'));
   if(kind==='outline'){
    const doc=directory.response_documents[0],name=doc.name.trim(),titles=doc.directory.map(n=>n.目录名称);
    const outline='# 响应文件：'+name+'\n\nscope：本机工程流程验收\n\n## 目录\n'+titles.map(t=>'- '+t).join('\n')+'\n\n## 来源标注\n\n## 目录说明\n';
    const sequence=[[call('outline_plan',{operation:'complete',volume:name,root_titles:titles.join('\n')})],[write('outline/tender-response-docs.md',outline)],[call('check_outline',{})],[call('assemble_tender',{})]];
    calls=sequence[step]??[];
   }
   if(kind==='guide'&&step===0)calls=[write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付验收章节 | 推理撰写 | — | — | 无 |')];
   if(kind==='promises'&&step===0)calls=[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |')];
   if(kind==='body'){if(blocking&&step===0){res.write(': waiting for cancellation\n\n');res.once('close',()=>cancelled.resolve());blocked.resolve();return;}calls=step===0?[call('docx_section_create',{path:'body/交付验收章节.docx',title:'交付验收章节',paragraphs:'本地目录交付原段落。'+('本文件为本机工程验收的合成投标正文，演示项目实施安排、职责、交付、验收及维护支持；具体履约指标须由真实材料和用户确认后补充。'.repeat(3))})]:step===1?[call('validate_body',{section:'body/交付验收章节.docx'})]:step===2?[call('check_pipeline_state',{}),call('validate_body',{section:'body'})]:[];}
   if(kind==='revise')calls=step===0?[call('docx_section_revise',{path:'body/交付验收章节.docx',edits:JSON.stringify([{para:2,action:'replace',find:'本地目录交付原段落',text:'本地目录交付修订段落'}])})]:step===1?[call('validate_body',{section:'body/交付验收章节.docx'})]:[];
   if(kind==='build'&&reuseBuild){
    const sequence=[[call('build_preparation',{})],[call('task',{subagent_type:'tender-body-writer',description:'delivery-resume-body-child'})],[call('check_pipeline_state',{}),call('validate_body',{section:'body'}),call('docx_assemble_volume',{})]];calls=sequence[step]??[];
   }else if(kind==='build'){
    const replied=text.includes('answer_to_pending_question');
    const replyCount=stageMessages.filter(message=>message.role==='user'&&String(typeof message.content==='string'?message.content:JSON.stringify(message.content)).includes('answer_to_pending_question')).length;
    const tools=stageMessages.filter(m=>m.role==='tool');
    const answered=tools.some(m=>String(m.content).includes('答复已保存'));
    const adjustedStep=step-(answered?1:0);
    if(!replied&&latestText.includes('维护期三年')){const questions=ctx.get('bidBusiness').ctx.sessionProjections.snapshot(ctx.agents.list().find(a=>a.status==='running').session,['userQuestions']).values.userQuestions.active;calls=[call('ooo_bidpliot_answer',{task_id:basename(cwd),batches:questions.filter(q=>q.state==='continued').map(q=>({call_id:q.callId,answers:q.questions.map(question=>({id:question.id,selected:['三年']}))}))})];}
    else {
    const sequence=[
     [call('build_preparation',{})],
     [write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付验收章节 | 推理撰写 | — | — | 无 |')],
     [call('validate_body',{section:'body/写作指引.md'})],
     [call('build_preparation',{stage:'guide'})],
     [call('ask_user_question',{questions:[{id:'term',question:'维护期是多少？',options:[{label:'三年'},{label:'五年'}]}]})],
     ...(repeatBuildQuestion?[replied?[call('ask_user_question',{questions:[{id:'delivery',question:'交付期限是多少？',options:[{label:'两个月'},{label:'三个月'}]}]})]:[]]:[]),
     replied&&(!repeatBuildQuestion||replyCount>=2)?[write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 维护期 | 三年 |'+(repeatBuildQuestion?'\n| 交付期限 | 两个月 |':''))]:[],
     [call('build_preparation',{stage:'promises'})],
     [call('task',{subagent_type:'tender-body-writer',description:'delivery-body-child'})],
     [call('check_pipeline_state',{}),call('validate_body',{section:'body'}),call('docx_assemble_volume',{})],
    ];calls=sequence[adjustedStep]??[];
    }
   }
  }
  if(analysisGate&&kind==='analyse'&&step===2)calls=Array.from({length:84},()=>call('read',{file_path:join(cwd,'work/analysis/structure.md')}));
  if(analysisGate&&kind==='analyse'&&step===3){
   const chunk=content=>res.write('data: '+JSON.stringify({id:'analysis-stream-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n');
   chunk('已读取原件，正在整理');analysisStreaming=true;
   await analysisGate.promise;
   if(res.destroyed)return;
   chunk('八份解读文件。');
   res.write('data: '+JSON.stringify({id:'analysis-stream-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');return;
  }
  if(kind&&!calls.length&&!(kind==='build'&&!text.includes('answer_to_pending_question'))){
   const tid=basename(cwd);

   if(kind==='analyse')content='# 招标文件解读完成\n\n'+await readFile(join(cwd,'work/analysis/structure.md'),'utf8')+'\n\n[解读下载]('+base+'/api/bidv4/workbench/raw?'+new URLSearchParams({task_id:tid,path:'analysis/structure.md'})+')';
   if(kind==='review'){const artifacts=await api('/artifacts?task_id='+tid);content='# 制作与审查已完成\n\n已按本轮真实原文完成审查，响应细节需确认。\n\n'+artifacts.artifacts.filter(a=>a.kind==='tender.volume').map(a=>'['+a.display_name+'下载]('+base+'/api/bidv4/artifacts/'+a.artifact_id+'/file)').join('\n');}
  }
  const delta=calls.length?{tool_calls:calls.map((c,index)=>({index,id:'delivery-'+randomUUID(),type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content};
  for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'delivery-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 }catch(error){fixtureErrors.push(error.stack);res.destroy(error)}
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
const profile=join(process.env.DSH_HOME,'profiles','web');
await mkdir(profile,{recursive:true});
// Only deterministic test settings are supplied here. Plugin registration is
// exclusively performed by `dsh plugin add/remove` in the parent verifier.
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},
 {id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'BID_DELIVERY_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'本机交付验收模型',contextWindow:131072,input:['text','image']},{id:'fixture-second',name:'第二验收模型',contextWindow:65536,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},
 {id:'session-title-llm',disabled:true},
]));
process.env.BID_DELIVERY_FIXTURE_KEY='local-delivery-test-only';
const {ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port',process.env.BID_DELIVERY_PORT??'0']});
hostContext=ctx;
const expectsBusiness=(JSON.parse(await readFile(join(profile,'package.json'),'utf8')).dsh?.profile?.bundles??[]).includes('ooo-bidpliot');
if(expectsBusiness)assert.ok(ctx.get('bidBusiness'),'Business plugin failed to start: '+JSON.stringify(ctx.logger.buffer.slice(-30).map(entry=>({name:entry.name,args:entry.args.map(String)}))));
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
  assert.ok(chatToolNames.every(name=>ctx.tools.get(name,handle.agent)));
  const start=requests.length;
  handle.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'查询项目进度和文档链接 task_id='+taskId}]}));
  await timeout(handle.agent.whenIdle(),'independent Agent');
  const events=handle.agent.session.snapshotEvents();
  assert.equal(events.findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
  const result=events.findLast(e=>e.type==='tool/result');assert.ok(result);assert.equal(result.data.message.isError,false,JSON.stringify(result.data));
  const actual=JSON.parse(result.data.message.content.find(c=>c.type==='text').text);
  assert.equal(actual.task_id,taskId,JSON.stringify({actual,calls:events.filter(e=>e.type==='tool/call').map(e=>e.data)}));assert.ok(actual.outputs.length);assert.ok(actual.documents.length);
  for(const {link} of [...actual.outputs,...actual.documents]){const url=new URL(link);assert.ok(['http:','https:'].includes(url.protocol),'Agent links must be absolute HTTP(S) URLs');assert.equal(url.origin,base,'Agent links must use the current official local host');}
  assert.ok(events.findLast(e=>e.type==='assistant/message').data.message.content.some(c=>c.type==='text'&&c.text.includes(']('+actual.outputs[0].link+')')),'Final Agent reply must expose the actual download link');
  assert.ok(requests.length>=start+2,'Must perform the real model→tool→reply cycle');
  const requestsInTurn=requests.slice(start);assert.ok(requestsInTurn.every(r=>r.tools.includes('ooo_bidpliot_status')));
  const document=actual.documents.find(d=>d.name==='structure.md'),documentResponse=await fetch(document.link,{headers:{Cookie:cookie}});
  assert.equal(documentResponse.status,200);assert.match(await documentResponse.text(),/本地目录验收 structure/);
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
 assert.ok((await runtime.ctx.agentPresets.list()).some(p=>p.id==='ooo-bidpliot'&&!p.broken));
 assert.ok((await ctx.agentPresets.list()).some(p=>p.id==='ooo-bidpliot'));
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
 await timeout(blocked.promise,'blocked child');await api('/page-flow/'+args.taskId+'/stop',{session_id:admitted.session_id,action_id:admitted.action_id});await timeout(cancelled.promise,'cancelled child');
 assert.equal((await api('/page-flow/'+args.taskId)).execution.state,'stopped');assert.deepEqual(await readdir(join(installation,'data/locks')),[]);blocking=false;
 return {sessionId:admitted.session_id,state:'stopped',childCancelled:true};
}
async function startAnalysis(options={}){
 analysisGate=Promise.withResolvers();analysisStreaming=false;
 const {task}=await api('/tasks',{title:'智能解读真实会话隔离验收',request_id:randomUUID()});
 const upload=new FormData();upload.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'交付验收原件.png');await api('/files?task_id='+task.id,upload);
 const state=await api('/page-flow/'+task.id);
 let admitted;if(options.workflow){await api('/page-flow/'+task.id+'/sources',{main_file:'交付验收原件.png',supplements:[],input_version:state.input_versions.analyse},'PUT');await api('/page-flow/'+task.id+'/workflow',{});while(!ctx.get('bidBusiness').workflows.records.get(task.id)?.session_id)await new Promise(resolve=>setTimeout(resolve,50));admitted={session_id:ctx.get('bidBusiness').workflows.records.get(task.id).session_id}}else admitted=await api('/page-flow/'+task.id+'/action',{kind:'analyse',request_id:randomUUID(),input_version:state.input_versions.analyse,main_file:'交付验收原件.png',supplements:[]});
 analysisTask={taskId:task.id,sessionId:admitted.session_id};return analysisTask;
}
async function finishAnalysis(){
 analysisGate.resolve();const runtime=ctx.get('bidBusiness'),handle=runtime.handles.get(analysisTask.sessionId);
 await timeout(handle.agent.whenIdle(),'analysis completion');await runtime.settling.get(analysisTask.taskId);analysisGate=undefined;
 return {state:(await api('/page-flow/'+analysisTask.taskId)).execution,...sessionEvidence(handle.agent.session.snapshotEvents())};
}
async function startFullWorkflow(){
 const {task}=await api('/tasks',{title:'页面自动全流程验收',request_id:randomUUID()});
 const upload=new FormData();upload.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64')]),'交付验收原件.png');await api('/files?task_id='+task.id,upload);
 const state=await api('/page-flow/'+task.id);await api('/page-flow/'+task.id+'/sources',{main_file:'交付验收原件.png',supplements:[],input_version:state.input_versions.analyse},'PUT');
 const company=await api('/library/companies',{name:'自动流程验收公司',profile:{legal_name:'验收法人',legal_title:'总经理',address:'验收地址',phone:'123',email:'fixture@example.test',fax:'无'}});
 await api('/projects/'+task.id+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-15',revision:0},'PUT');
 await api('/page-flow/'+task.id+'/workflow',{});return task.id;
}
async function fullQuestionFlushRace(rounds=1){
 const runtime=ctx.get('bidBusiness'),gates=Array.from({length:rounds},()=>({entered:Promise.withResolvers(),release:Promise.withResolvers()})),gatedCalls=new Set(),roundEvidence=[],settlements=[];
 const flush=ctx.sessions.flush,update=runtime.updateRecord,updates=[];
 let taskId,gateCount=0,off,agent,originalHashes,upstream,prefix;
 const actionRecords=async()=>Promise.all((await readdir(join(installation,'data/actions',taskId))).filter(file=>file.endsWith('.json')&&file!=='latest.json').map(async file=>JSON.parse(await readFile(join(installation,'data/actions',taskId,file),'utf8'))));
 const hashes=async()=>Object.fromEntries(await Promise.all(analysis.map(async key=>[key,sha(await readFile(join(installation,'data/workspace',taskId,'work/analysis',key+'.md')))])));
 runtime.updateRecord=async function(record,patch){
  const value=await update.call(this,record,patch);
  if(record.kind==='build'&&['outcome','end_seq','start_seq'].some(key=>Object.hasOwn(patch,key)))updates.push({actionId:record.action_id,patch:structuredClone(patch)});
  return value;
 };
 ctx.sessions.flush=async function(session){
  const owner=taskId&&runtime.executionOwners.get(taskId),agent=owner?.agent;
  if(gateCount<rounds&&owner?.waitingForIdle===false&&agent.session===session&&agent.status==='idle'){
   const record=JSON.parse(await readFile(join(installation,'data/actions',taskId,'latest.json'),'utf8'));
   const questions=owner.questions?.active?.filter(question=>question.state==='continued'&&!gatedCalls.has(question.callId))??[];
   if(record.kind==='build'&&record.action_id===owner.actionId&&questions.length){
    const gate=gates[gateCount++];for(const question of questions)gatedCalls.add(question.callId);
    // Persist the genuine SDK snapshot, but hold the runtime's outcome write.
    await flush.call(this,session);
    gate.entered.resolve({agent,record,questions,boundary:owner.endSeq,events:session.snapshotEvents()});
    await gate.release.promise;return;
   }
  }
  return flush.call(this,session);
 };
 try{
  taskId=await startFullWorkflow();
  for(const [index,gate]of gates.entries()){
   const held=await timeout(gate.entered.promise,'full build question '+(index+1)+' final flush');agent=held.agent;
   if(index===0){originalHashes=await hashes();upstream=(await actionRecords()).filter(record=>record.kind!=='build');prefix=held.events}
   const oldSettlement=runtime.settling.get(taskId);let oldSettled=false;void oldSettlement.then(()=>{oldSettled=true});settlements.push(oldSettlement);
   assert.ok(oldSettlement);assert.equal(agent.status,'idle');assert.equal(held.record.outcome,index===0?undefined:null);assert.equal(held.record.end_seq,index===0?undefined:null);
   const requestCount=requests.length,replyStarted=Promise.withResolvers();
   off=ctx.on('session/event',(session,event)=>{if(session.id===agent.id&&event.type==='turn/start'&&event.seq>held.boundary)replyStarted.resolve(event)},{global:true});
   for(const question of held.questions)assert.ok(ctx.userQuestions.answer(agent,question.callId,{answers:question.questions.map(item=>({id:item.id,selected:[item.options[0].label]}))}));
   const replyTurn=await timeout(replyStarted.promise,'native answer '+(index+1)+' turn before flush release');
   assert.equal(agent.status,'running');assert.equal(oldSettled,false,'The real reply turn starts while the previous outcome is still unpersisted');
   assert.equal(requests.length,requestCount,'The reply must wait for old persistence before issuing another model request');
   const during={oldSettled,agentStatus:agent.status,modelRequests:requests.length,boundary:held.boundary,replyTurnSeq:replyTurn.seq};
   off();off=undefined;gate.release.resolve();const settled=await oldSettlement;
   roundEvidence.push({questions:held.questions,prefix:held.events,during,settled});
  }
  await runtime.workflows.wait(taskId);await agent.whenIdle();await runtime.settling.get(taskId);await runtime.workflows.wait(taskId);
  await ctx.sessions.flush(agent.session);
  return {taskId,sessionId:agent.id,state:await api('/page-flow/'+taskId),records:await actionRecords(),events:agent.session.snapshotEvents(),prefix,originalHashes,hashes:await hashes(),upstream,during:roundEvidence[0].during,questions:roundEvidence[0].questions,rounds:roundEvidence,distinctSettlements:new Set(settlements).size,updates,fixtureErrors,admissions:runtime.admissions.size,owners:runtime.executionOwners.size,settling:runtime.settling.size,workflowStarts:runtime.workflows.starts.size,workflowJobs:runtime.workflows.jobs.size,workflowResumptions:runtime.workflows.resumptions.size,locks:await readdir(join(installation,'data/locks'))};
 }finally{for(const gate of gates)gate.release.resolve();off?.();ctx.sessions.flush=flush;runtime.updateRecord=update}
}
async function fullQuestionStop(){
 const runtime=ctx.get('bidBusiness'),taskId=await startFullWorkflow();await runtime.workflows.wait(taskId);
 const state=await api('/page-flow/'+taskId);assert.equal(state.workflow.state,'needs_input');assert.equal(state.execution.kind,'build');
 const agent=runtime.handles.get(state.session_id).agent,prefix=agent.session.snapshotEvents();
 const hashes=async()=>Object.fromEntries(await Promise.all(analysis.map(async key=>[key,sha(await readFile(join(installation,'data/workspace',taskId,'work/analysis',key+'.md')))])));
 const originalHashes=await hashes();
 crashAfterBody=true;
 try{
  for(const question of state.execution.questions)assert.ok(ctx.userQuestions.answer(agent,question.callId,{answers:question.questions.map(item=>({id:item.id,selected:['三年']}))}));
  await timeout(crashBlocked.promise,'durable body child before native stop');
  const bodyPath=join(installation,'data/workspace',taskId,'work/body/交付验收章节.docx'),savedBodyHash=sha(await readFile(bodyPath));
  const requestsAtStop=requests.length;assert.equal(agent.status,'running');
  // Exercise the real native Stop button path; do not call workflows.stop.
  agent.cancel({kind:'user'});await agent.whenIdle();
  await Promise.all([...runtime.settling.values(),...runtime.workflows.starts.values(),...runtime.workflows.jobs.values(),...Array.from(runtime.workflows.resumptions.values(),entry=>entry.promise)]);
  await runtime.workflows.wait(taskId);await runtime.settling.get(taskId);await ctx.sessions.flush(agent.session);
  const records=await Promise.all((await readdir(join(installation,'data/actions',taskId))).filter(file=>file.endsWith('.json')&&file!=='latest.json').map(async file=>JSON.parse(await readFile(join(installation,'data/actions',taskId,file),'utf8'))));
  return {taskId,sessionId:agent.id,state:await api('/page-flow/'+taskId),records,prefix,events:agent.session.snapshotEvents(),originalHashes,hashes:await hashes(),savedBodyHash,bodyHash:sha(await readFile(bodyPath)),requestsAtStop,requestsAfterDrain:requests.length,fixtureErrors,admissions:runtime.admissions.size,owners:runtime.executionOwners.size,settling:runtime.settling.size,workflowStarts:runtime.workflows.starts.size,workflowJobs:runtime.workflows.jobs.size,workflowResumptions:runtime.workflows.resumptions.size,locks:await readdir(join(installation,'data/locks'))};
 }finally{crashAfterBody=false}
}
const nativeFollowers=new Map();
let ending=false;
async function close(){
 if(ending)return;ending=true;for(const {abort} of nativeFollowers.values())abort.abort();nativeFollowers.clear();
 const logs=ctx.logger.buffer,runtimeLogs=ctx.get('bidBusiness')?.ctx.logger.buffer;
 try{await ctx.fiber.dispose();}
 finally{endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));}
 const failures=[...(logs??[]),...(runtimeLogs??[])].filter(entry=>/closed handle|final drain.*failed|best-effort final session flush failed|unhandled rejection/i.test(entry.args.map(String).join(' '))).map(entry=>({name:entry.name,args:entry.args.map(String)}));
 assert.deepEqual(failures,[],'Session drain diagnostics must be clean');
}
process.on('message',async({id,command,args})=>{
 try{
  let result;
  if(command==='nativeFollow'){
   const abort=new AbortController();
   const iterator=ctx.sessionController.follow({address:{kind:'session',sessionId:args.sessionId},assistantStream:true,maxMessages:args.maxMessages??50},abort.signal);
   nativeFollowers.set(args.key,{abort,iterator});result=(await iterator.next()).value;
  }
  else if(command==='nativeNext')result=(await nativeFollowers.get(args.key).iterator.next()).value;
  else if(command==='nativeClose'){nativeFollowers.get(args.key)?.abort.abort();nativeFollowers.delete(args.key);result={ok:true}}
  else if(command==='nativePage')result=await ctx.sessionController.page(args,new AbortController().signal);
  else if(command==='nativeList')result=await ctx.sessionController.list({},new AbortController().signal);
  else if(command==='nativeEvidence'){
   const observed=await ctx.sessionQuery.observeSession(args.sessionId,{projectionMode:'none'});
   try{result={...sessionEvidence(observed.events),events:observed.events,modelRequests:requests.length,handles:ctx.get('bidBusiness').handles.size,live:!!ctx.agents.get(args.sessionId),sameAgent:ctx.agents.get(args.sessionId)===ctx.get('bidBusiness').handles.get(args.sessionId)?.agent}}finally{observed[Symbol.dispose]()}
  }
  else if(command==='projectEvidence'){
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),folder=join(installation,'data/actions',args.taskId);
   const records=await Promise.all((await readdir(folder)).filter(name=>name.endsWith('.json')&&name!=='latest.json').map(async name=>JSON.parse(await readFile(join(folder,name),'utf8'))));
   const observation=await ctx.sessionQuery.observeSession(state.session_id,{projectionMode:'none'});
   try{result={sessionId:state.session_id,records:await Promise.all(records.map(async record=>({...record,projection:await runtime.projection(record)}))),events:observation.events,presets:await ctx.agentPresets.list(),children:await ctx.subagents.listChildren(state.session_id)}}finally{observation[Symbol.dispose]()}
  }
  else if(command==='relocateFixtureSession'){
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),agent=(await runtime.handle({session_id:state.session_id})).agent;
   // The checked-in synthetic legacy session was made in another temporary
   // directory. Set its fixture location through the official durable API.
   assert.equal(basename(agent.session.header.cwd),args.taskId);await ctx.workingDirectory.set(agent,join(installation,'data/workspace',args.taskId));await ctx.sessions.flush(agent.session);result={ok:true};
  }
  else if(command==='projectTool'){
   const runtime=ctx.get('bidBusiness'),state=await runtime.state(args.taskId),agent=(await runtime.handle({session_id:state.session_id})).agent;
   const value=await ctx.tools.execute({callId:randomUUID(),name:args.name,arguments:{task_id:args.taskId,...args.parameters},agent,signal:AbortSignal.timeout(15000)});
   assert.equal(value.isError,false,JSON.stringify(value));result=JSON.parse(value.value);
  }
  else if(command==='queryProject'){
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),agent=(await runtime.handle({session_id:state.session_id})).agent;
   const before=(await runtime.latestRecord(args.taskId,state.execution.kind)).record.model;
   agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'查询项目进度 task_id='+args.taskId}]}));await agent.whenIdle();
   result={before,after:(await runtime.latestRecord(args.taskId,state.execution.kind)).record.model,lastRequest:requests.at(-1)};
  }
  else if(command==='selectMainModel'){
   const state=await api('/page-flow/'+args.taskId);
   await ctx.sessionController.selectModel({sessionId:state.session_id,provider:'fixture',model:args.model});
   await ctx.agentDefaultModel.saveSelection(model);
   result={defaultModel:ctx.agentDefaultModel.currentSelection()};
  }
  else if(command==='settleProject'){
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),handle=await runtime.handle({session_id:state.session_id});
   await handle.agent.whenIdle();await runtime.settling.get(args.taskId);
   result={state:await api('/page-flow/'+args.taskId),lastRequest:requests.at(-1)};
  }
  else if(command==='modelCount')result=requests.length;
  else if(command==='reviewEarlyEnd'){reviewEarlyEnd=args.mode;result={ok:true}}
  else if(command==='chatReady'){const {workspace}=await ctx.workspaceController.create({path:installation});const created=await ctx.sessionController.create({workspaceId:workspace.workspaceId,agentPreset:presetId});await ctx.sessionTitle.rename(ctx.agents.get(created.sessionId).session,'对话上传验收');result={sessionId:created.sessionId}}
  else if(command==='chatAnalysis'||command==='chatFull'){
   const handle=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:installation,agentPreset:presetId},agentOptions:model,setup:async c=>{await ctx.agentPresets.mount(c,presetId)}});
   const attachment=await ctx.attachments.saveFile({data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==','base64'),name:'交付验收原件.png'});
   try{
    handle.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:command==='chatFull'?'请自动完成上传文件的解读、制作、合册和审查，项目名称：对话全流程验收。公司资料：对话验收公司、验收法人、总经理、验收地址、电话123、fixture@example.test、传真无、2026-10-15签字。':'请解析并解读上传的招标文件，项目名称：对话上传验收。'},{type:'file',attachment}]}));
    await handle.agent.whenIdle();if(command==='chatFull'){const current=(await api('/tasks')).tasks.find(t=>t.title==='对话全流程验收');await ctx.get('bidBusiness').workflows.wait(current.id);handle.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'维护期三年，继续对话全流程验收。'}]}));await handle.agent.whenIdle();await ctx.get('bidBusiness').settling.get(current.id);await ctx.get('bidBusiness').workflows.wait(current.id)}await ctx.sessions.flush(handle.agent.session);
    const observation=await ctx.sessionQuery.observeSession(handle.agent.id,{projectionMode:'none'});
    try{result={sessionId:handle.agent.id,events:observation.events,tasks:await api('/tasks')}}finally{observation[Symbol.dispose]()}
   }finally{await handle.dispose()}
  }
  else if(command==='fullWorkflow'){
   const taskId=await startFullWorkflow();await ctx.get('bidBusiness').workflows.wait(taskId);
   result={taskId,state:await api('/page-flow/'+taskId)};
  }
  else if(command==='fullQuestionFlushRace')result=await fullQuestionFlushRace();
  else if(command==='fullQuestionRepeat'){repeatBuildQuestion=true;try{result=await fullQuestionFlushRace(2)}finally{repeatBuildQuestion=false}}
  else if(command==='fullQuestionStop')result=await fullQuestionStop();
  else if(command==='nativeAnswer'){
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),agent=(await runtime.handle({session_id:state.session_id})).agent;
   for(const question of state.execution.questions)assert.ok(ctx.userQuestions.answer(agent,question.callId,{answers:question.questions.map(q=>({id:q.id,selected:['三年']}))}));
   await agent.whenIdle();await runtime.settling.get(args.taskId);await runtime.workflows.wait(args.taskId);result=await api('/page-flow/'+args.taskId);
  }
  else if(command==='waitWorkflow'){await ctx.get('bidBusiness').workflows.wait(args.taskId);result={...(await api('/page-flow/'+args.taskId)),fixture_errors:fixtureErrors}}
  else if(command==='crashAfterBody'){crashAfterBody=true;result={ok:true}}
  else if(command==='resumeExistingBuild'){reuseBuild=true;result={ok:true}}
  else if(command==='crashCheckpoint'){
   await timeout(crashBlocked.promise,'durable body checkpoint');
   const runtime=ctx.get('bidBusiness'),state=await api('/page-flow/'+args.taskId),agent=runtime.handles.get(state.session_id).agent;await ctx.sessions.flush(agent.session);
   result={state,bodyHash:sha(await readFile(join(installation,'data/workspace',args.taskId,'work/body/交付验收章节.docx'))),events:agent.session.snapshotEvents(),requestCount:requests.length};
  }
  else if(command==='analysisStart')result=await startAnalysis(args);
  else if(command==='analysisRelease')result=await finishAnalysis();
  else if(command==='analysisState')result={streaming:analysisStreaming,modelRequests:requests.length,handles:ctx.get('bidBusiness').handles.size,events:analysisTask?sessionEvidence(ctx.get('bidBusiness').handles.get(analysisTask.sessionId).agent.session.snapshotEvents()):undefined};
  else if(command==='reload'){
   const entry=[...ctx.loader.entries()].find(e=>e.options.id==='ooo-bidpliot');
   await entry.update({disabled:true});await ctx.loader.await();
   await entry.update({disabled:false});await ctx.loader.await();
   result={active:!!ctx.get('bidBusiness'),logs:ctx.logger.buffer.slice(-20).map(e=>({name:e.name,args:e.args.map(String)}))};
  }
  else if(command==='overview')result=await overview();
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
