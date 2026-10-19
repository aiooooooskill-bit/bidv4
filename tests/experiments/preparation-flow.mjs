import {pythonExecutable} from '../../server/platform.mjs';
// Deliberately outside tests/*.test.mjs: run through the disposable-copy runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,cp} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {root,dataRoot,business} from '../../server/native/business.mjs';

const candidate=process.env.BIDV4_PREPARATION_FIXTURE==='1'?'auto':process.env.PREPARATION_CANDIDATE;
const reportPath=process.env.PREPARATION_REPORT??join(dataRoot,'preparation-report.json');
if(!candidate)throw new Error('Use scripts/verify-preparation-flow.mjs; never run against project data');
const real=candidate==='real';
const directory={response_documents:[{name:'工程验证册',directory:['工程验证章节','保留章节'].map(title=>({目录名称:title,level:1,children:[]}))}]};
const guide='# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 工程验证章节 | 推理撰写 | — | — | 维护期由用户确定 |\n| 保留章节 | 推理撰写 | — | — | 保留已有内容 |';
const promises=value=>'# 关键事实与承诺\n\n| 事项 | 值 | 说明 |\n|---|---|---|\n| 维护期 | '+value+' | 用户确定 |';
const servicePromises=value=>'| 事项 | 值 | 说明 |\n|---|---|---|\n| 服务时间 | 电话支持\\|'+value+'小时 | 用户确认 |';
const analysis=['structure','requirements-submission','requirements-business','requirements-qualification','evaluation','requirements-format','disqualification','clarifications'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const realLimitMs=1800000;
const sourceName=real?'工程源.docx':'工程源.txt';

test('隔离制作准备技术验证：'+candidate,{timeout:real?realLimitMs+90000:120000},async()=>{
 let ctx,mode='normal',stopEntered,requestCount=0,realCount=0,realStarted=0,realTask,realRun;
 const traces=[],results=[],modelRequests=[];
 const call=(name,args)=>({name,args});
 const endpoint=createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const request=JSON.parse(raw);requestCount++;
   const text=request.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
   const anchor=request.messages.findLastIndex(m=>m.role==='user'&&String(m.content).includes('页面输入：'));
   const currentText=request.messages[anchor]?.content??'';
   const payloadText=currentText.match(/页面输入：(\{[^\n]+\})/)?.[1],payload=payloadText?JSON.parse(payloadText):null,kind=payload?.kind;
   const cwd=currentText.match(/当前任务绝对路径：([^；]+)；/)?.[1];
   if(mode==='real'&&(!payload||kind==='body')){
    if(++realCount>100)throw new Error('Real-model verification exceeded 100 requests');
    const timing={request:realCount,startedAt:new Date().toISOString()};modelRequests.push(timing);
    console.log('REAL request '+realCount+' started');
    await writeFile(reportPath.replace('.json','-progress.json'),JSON.stringify({modelRequests,results},null,2));
    const upstream=await fetch('http://127.0.0.1:8000/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,model:'mlx-community/Qwen3.8-27B-4bit'}),signal:AbortSignal.timeout(180000)});
    if(!upstream.ok)throw new Error('Local model HTTP '+upstream.status);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    let streamText='';for await(const chunk of upstream.body){streamText+=Buffer.from(chunk).toString();res.write(chunk)}res.end();
    timing.elapsedMs=Date.now()-Date.parse(timing.startedAt);timing.finishReasons=[];
    for(const line of streamText.split('\n'))if(line.startsWith('data: {')){try{const data=JSON.parse(line.slice(6));for(const choice of data.choices??[])if(choice.finish_reason)timing.finishReasons.push(choice.finish_reason);if(data.usage)timing.usage=data.usage}catch{}}
    console.log('REAL request '+realCount+' finished '+timing.elapsedMs+'ms '+timing.finishReasons.join(','));
    await writeFile(reportPath.replace('.json','-progress.json'),JSON.stringify({modelRequests,results},null,2));return;
   }
   const step=request.messages.slice(anchor).filter(m=>m.role==='assistant'&&m.tool_calls?.length).length;
   const write=(path,content)=>call('write',{file_path:join(cwd,'work',path),content});
   const initial=JSON.parse(currentText.match(/制作状态：(\{[^；]+\})；/)[1]);
   const replied=JSON.stringify(request.messages.slice(anchor).filter(m=>m.role==='user')).includes('answer_to_pending_question');
   let sequence=[];
   if(kind==='analyse')sequence=[analysis.map(n=>write('analysis/'+n+'.md','# 工程夹具 '+n+'\n本项目需要实施方案，维护期由用户确定。'))];
   if(kind==='outline'){
    const doc=directory.response_documents[0],name=doc.name.trim(),titles=doc.directory.map(n=>n.目录名称);
    const outline='# 响应文件：'+name+'\n\nscope：本机工程流程验收\n\n## 目录\n'+titles.map(t=>'- '+t).join('\n')+'\n\n## 来源标注\n\n## 目录说明\n';
    sequence=[[call('outline_plan',{operation:'complete',volume:name,root_titles:titles.join('\n')})],[write('outline/tender-response-docs.md',outline)],[call('check_outline',{})],[call('assemble_tender',{})]];
   }
   if(kind==='guide')sequence=[[write('body/写作指引.md',guide)],[call('validate_body',{section:'body/写作指引.md'})]];
   const question=[call('ask_user_question',{questions:[{id:'term',question:'维护期是多少？',options:[{label:'三年'},{label:'五年'}]}]})];
   if(kind==='promises'&&mode==='duplicate-repair')sequence=[[call('read',{file_path:join(cwd,'work/body/关键事实与承诺.md')})],[write('body/关键事实与承诺.md',promises('五年'))]];
   else if(kind==='promises'&&mode==='pipe-leak')sequence=[[write('body/关键事实与承诺.md',servicePromises('5×8'))]];
   else if(kind==='promises'&&mode==='value-edit-leak')sequence=[[call('read',{file_path:join(cwd,'work/body/关键事实与承诺.md')})],[call('edit',{file_path:join(cwd,'work/body/关键事实与承诺.md'),old_string:'五年',new_string:'一年',replace_all:true})]];
   else if(kind==='promises')sequence=mode==='value-leak'?[[write('body/关键事实与承诺.md',promises('一年'))]]:[question,replied?[write('body/关键事实与承诺.md',promises('三年'))]:[]];
   if(kind==='body'){
    {
     sequence.push([call('build_preparation',{})]);
     if(initial.guide!=='ready')sequence.push([write('body/写作指引.md',guide)],[call('validate_body',{section:'body/写作指引.md'})],[call('build_preparation',{stage:'guide'})]);
     if(initial.promises!=='ready'){
      let value='三年';try{const old=await readFile(join(cwd,'work/body/关键事实与承诺.md'),'utf8');if(old.includes('五年'))value='五年'}catch(e){if(e.code!=='ENOENT')throw e}
      sequence.push(question,replied?[write('body/关键事实与承诺.md',promises(value))]:[],[call('build_preparation',{stage:'promises'})]);
     }
    }
    sequence.push([call('docx_section_create',{path:'.\\body\\工程验证章节.docx',title:'工程验证章节',paragraphs:'工程实施计划。维护期按用户已确定的承诺执行。',replace:true})],[call('validate_body',{section:'.\\body\\工程验证章节.docx'})]);
    if(mode==='scope-leak')sequence.push([call('docx_section_create',{path:'body/保留章节.docx',title:'保留章节',paragraphs:'非所选章被覆盖。',replace:true})],[call('validate_body',{section:'body/保留章节.docx'})]);
    if(mode==='raw-scope-leak')sequence.push([write('body/保留章节.docx','不允许覆盖')],[call('edit',{file_path:join(cwd,'work/body/关键事实与承诺.md'),old_string:'五年',new_string:'一年',replace_all:true})]);
    if(mode==='value-leak')sequence.push([write('body/关键事实与承诺.md',promises('一年'))],[call('build_preparation',{stage:'promises'})]);
   }
   const calls=sequence[step]??[];
   if(mode==='stop'&&kind==='body'&&calls[0]?.name==='ask_user_question'){
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': waiting\n\n');stopEntered();return;
   }
   traces.push({kind,step,calls:calls.map(c=>c.name),writes:calls.filter(c=>c.name==='write').map(c=>c.args.file_path.split('/work/')[1])});
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const delta=calls.length?{tool_calls:calls.map((c,index)=>({index,id:'fixture-'+randomUUID(),type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'工程夹具执行结束'};
   for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');
   res.end('data: [DONE]\n\n');
  }catch(e){res.destroy(e)}
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 const record=(name,details)=>{results.push({name,...details});console.log('RESULT '+JSON.stringify({...results.at(-1),...(details.tools?{tools:details.tools.map(t=>t.name)}:{})}))};
 try{
  const profile=join(process.env.DSH_HOME,'profiles','web');await mkdir(join(profile,'node_modules'),{recursive:true});
  await symlink(root,join(profile,'node_modules/ooo-bidpliot'),process.platform==='win32'?'junction':'dir');
  await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},{id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'PREPARATION_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'fixture',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},{id:'session-title-llm',disabled:true}]));
  process.env.PREPARATION_FIXTURE_KEY='local-test-only';
  const {runProfile}=await import('../../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
  const runtime=ctx.get('bidBusiness'),base='http://127.0.0.1:'+ctx.webServer.port;
  const login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  async function api(path,body,method=body?'POST':'GET',expected=200){
   const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
   const value=await response.json();assert.ok(expected===200?response.ok:response.status===expected,JSON.stringify({path,status:response.status,value}));return value;
  }
  const state=tid=>api('/page-flow/'+tid);
  async function start(tid,kind,options={}){const s=await state(tid);return api('/page-flow/'+tid+'/action',{kind,request_id:randomUUID(),input_version:s.input_versions[kind],main_file:sourceName,supplements:[],sections:kind==='body'?[{volume:'工程验证册',title:'工程验证章节'}]:[],...options});}
  async function settle(tid,run){
   let timer;const idle=runtime.handles.get(run.session_id).agent.whenIdle();
   try{if(mode==='real')await Promise.race([idle,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Real-model verification reached its 30-minute limit')),Math.max(1,realLimitMs-(Date.now()-realStarted)))})]);else await idle}finally{clearTimeout(timer)}
   await runtime.settling.get(tid);return state(tid);
  }
  async function answer(tid,s){const q=s.execution.questions[0];assert.ok(q);await api('/page-flow/'+tid+'/answer',{session_id:s.execution.session_id,call_ids:[q.callId],batches:[{call_id:q.callId,answers:q.questions.map(item=>({id:item.id,selected:[],custom:'维护期为三年；其余没有提供的公司事实请留批注，不编造。'}))}]});return settle(tid,{session_id:s.execution.session_id});}
  async function seed(){
   const {task}=await api('/tasks',{title:'隔离准备验证',request_id:randomUUID()});const company=await api('/library/companies',{name:'工程公司',profile:{legal_name:'工程法人',legal_title:'总经理'}});await api('/projects/'+task.id+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-12',revision:0},'PUT');const source=join(dataRoot,'workspace',task.id,'sources',sourceName);
   if(real){
    execFileSync(pythonExecutable(root),['-X','utf8','-c','from docx import Document; import sys; d=Document(); d.add_heading("工程验证采购项目",0); d.add_paragraph("本文件为独立技术验证的合成招标资料，用于验证投标工作台的写作准备、维护承诺问答及单章生成流程，不对应真实采购项目。工程验证章节应说明简要实施步骤和后续维护安排，包括需求梳理、实施交付、维护服务三个环节，正文约一百五十字即可。"); d.add_paragraph("维护期由投标人承诺，尚未提供具体年限，必须询问用户后按答复写入关键事实与承诺及章节正文，不得自行编造。保留章节为已经存在的人工正文，内容和文件必须保持原样，不得覆盖，不需要更新该章。仅生成工程验证章节，不扩展到全册，不需要合册或发布整本标书。本次不要求公司资质、人员数量、服务响应时限、报价、图表或图片，也不要求新增其他章节。"); d.save(sys.argv[1])',source]);
    await business(runtime.ctx,'prepare',{task_id:task.id,file_name:sourceName});
   }else await writeFile(source,'工程招标夹具：要求实施方案，维护期由投标人决定。');
   for(const kind of ['analyse','outline'])await settle(task.id,await start(task.id,kind,kind==='outline'?{page_target:null,numbering:'decimal'}:{}));
   await business(runtime.ctx,'tool',{name:'docx_section_create',parameters:{path:'body/保留章节.docx',title:'保留章节',paragraphs:'人工保留内容，不允许改单章以外文件。'}},{taskId:task.id});await business(runtime.ctx,'tool',{name:'validate_body',parameters:{section:'body/保留章节.docx'}},{taskId:task.id});return task.id;
  }
  const tid=await seed(),other=join(dataRoot,'workspace',tid,'work/body/保留章节.docx'),before=sha(await readFile(other));
  let s=await state(tid);assert.deepEqual(s.build_preparation,{guide:'missing',promises:'missing'});assert.equal(s.body_sections.length,2);
  {
   mode=real?'real':'normal';const started=Date.now();realStarted=started;realTask=tid;
   const run=await start(tid,'body',{instruction:'只写工程验证章节，正文约150字；保留章节不能更改。维护期需要由用户决定，目前未提供。共享准备齐全后只写所选章，不合册。'});
   realRun=run;
   s=await settle(tid,run);
   if(real){
    const h=runtime.handles.get(run.session_id),tools=()=>{const events=h.agent.session.snapshotEvents(),names=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data.name]));return events.filter(e=>e.type==='tool/result').map(e=>({name:names.get(e.data.message.toolCallId),result:e.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('')}))};
    record('real-model-first-turn',{execution:s.execution,preparation:s.build_preparation,tools:tools()});
    assert.equal(s.execution.state,'needs_input',JSON.stringify(s.execution));
    assert.equal(s.body_sections[0].status,'missing');s=await answer(tid,s);
    record('real-model-final',{state:s.execution.state,error:s.execution.error,preparation:s.build_preparation,selectedChapter:s.body_sections[0].status,otherUnchanged:sha(await readFile(other))===before,requests:realCount,elapsedMs:Date.now()-started,tools:tools()});
    assert.equal(s.execution.state,'completed',s.execution.error);assert.deepEqual(s.build_preparation,{guide:'ready',promises:'ready'});assert.equal(s.body_sections[0].status,'ready');assert.equal(sha(await readFile(other)),before);
    assert.equal(s.execution.session_id,run.session_id);assert.match(await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8'),/三\s*年|3\s*年/);
    record('real-model-assertions',{pass:true,sameSession:true,preparationReady:true,selectedDocxValidated:true,otherDocxBytesUnchanged:true,userValueRecorded:true});
   }else{
    assert.equal(s.execution.state,'needs_input');assert.equal(s.execution.session_id,run.session_id);assert.deepEqual(s.build_preparation,{guide:'ready',promises:'missing'},JSON.stringify({traces,questions:s.execution.questions}));assert.equal(s.body_sections[0].status,'missing');
    s=await answer(tid,s);assert.equal(s.execution.state,'completed',s.execution.error);assert.equal(s.execution.session_id,run.session_id);assert.equal(s.body_sections[0].status,'ready');assert.equal(sha(await readFile(other)),before);
    record('auto-preparation-and-question',{pass:true,actionSubmissions:1,questionSubmissions:1,sameSession:true,otherUnchanged:true,nonselectedStatus:s.body_sections[1].status});
    const planning=['写作指引.md','关键事实与承诺.md'],hashes=await Promise.all(planning.map(n=>readFile(join(dataRoot,'workspace',tid,'work/body',n)).then(sha))),traceStart=traces.length;
    await settle(tid,await start(tid,'body'));assert.deepEqual(await Promise.all(planning.map(n=>readFile(join(dataRoot,'workspace',tid,'work/body',n)).then(sha))),hashes);
    assert.ok(!traces.slice(traceStart).some(t=>t.writes.length));record('ready-planning-reuse',{pass:true,planningWrites:0});
    const stopId=await seed();mode='stop';const entered=new Promise(resolve=>{stopEntered=resolve});const stoppedRun=await start(stopId,'body');await entered;
    await api('/page-flow/'+stopId+'/stop',{session_id:stoppedRun.session_id,action_id:stoppedRun.action_id});s=await state(stopId);assert.equal(s.execution.state,'stopped');assert.deepEqual(s.build_preparation,{guide:'ready',promises:'missing'});
    const guideFile=join(dataRoot,'workspace',stopId,'work/body/写作指引.md'),guideHash=sha(await readFile(guideFile));mode='normal';s=await settle(stopId,await start(stopId,'body'));s=await answer(stopId,s);assert.equal(s.execution.state,'completed');assert.equal(sha(await readFile(guideFile)),guideHash);record('stop-and-resume',{pass:true,guideReused:true});
    const content=await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8');
    await api('/workbench/content',{task_id:tid,path:'body/关键事实与承诺.md',content:promises('五年'),base_hash:sha(Buffer.from(content))},'PUT');
    const oldGuide=await readFile(join(dataRoot,'workspace',tid,'work/body/写作指引.md'),'utf8');
    await api('/workbench/content',{task_id:tid,path:'body/写作指引.md',content:oldGuide+'\n\n用户要求：采用用户已确定的五年维护期。',base_hash:sha(Buffer.from(oldGuide))},'PUT');
    s=await state(tid);assert.deepEqual(s.build_preparation,{guide:'ready',promises:'stale'});await api('/page-flow/'+tid+'/action',{kind:'body',request_id:randomUUID(),input_version:s.input_versions.body,sections:[{volume:'工程验证册',title:'工程验证章节'}]},'POST',409);const currentPromises=await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8');await api('/workbench/content',{task_id:tid,path:'body/关键事实与承诺.md',content:currentPromises,base_hash:sha(Buffer.from(currentPromises))},'PUT');s=await settle(tid,await start(tid,'body'));assert.equal(s.execution.state,'completed');assert.ok((await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8')).includes('五年'));record('user-edit-and-stale-planning',{pass:true,staleAdmissionRejected:true,userReviewed:true,valuePreserved:'五年'});
   }
   // Adversarial tool output: does sections mechanically prevent unrelated writes?
   if(!real){mode='scope-leak';await settle(tid,await start(tid,'body'));const changed=sha(await readFile(other))!==before;assert.equal(changed,false);record('nonselected-chapter-write-guard',{protected:true});mode='raw-scope-leak';await settle(tid,await start(tid,'body'));assert.equal(sha(await readFile(other)),before);assert.ok((await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8')).includes('五年'));record('plain-write-and-edit-guard',{protected:true});
    mode='value-leak';s=await settle(tid,await start(tid,'promises'));assert.ok((await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8')).includes('五年'));assert.equal(s.execution.state,'failed');assert.match(s.execution.error,/维护期：五年 → 一年/);record('confirmed-value-write-guard',{protected:true,differenceVisible:true});mode='value-edit-leak';s=await settle(tid,await start(tid,'promises'));assert.equal(s.execution.state,'failed');assert.match(s.execution.error,/维护期：五年 → 一年/);assert.ok((await readFile(join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md'),'utf8')).includes('五年'));record('confirmed-value-edit-guard',{protected:true});}
  }
  if(!real){
   const path=join(dataRoot,'workspace',tid,'work/body/关键事实与承诺.md');
   // Simulate an unvalidated intermediate file retained from an interrupted run.
   await writeFile(path,promises('五年')+'\n| 维护期 | 五 年 | 用户确认 |');
   mode='duplicate-repair';s=await settle(tid,await start(tid,'promises'));
   assert.equal(s.execution.state,'completed',s.execution.error);assert.equal(s.build_preparation.promises,'ready');assert.equal(await readFile(path,'utf8'),promises('五年'));
   record('duplicate-intermediate-repair',{pass:true,valuePreserved:true});
   const current=await readFile(path,'utf8');
   const guidePath=join(dataRoot,'workspace',tid,'work/body/写作指引.md'),beforeGuide=await readFile(guidePath,'utf8');
   for(const relative of ['./body/写作指引.md','.\\body\\写作指引.md','body/../body/写作指引.md']){
    await api('/workbench/content',{task_id:tid,path:relative,content:'# invalid',base_hash:sha(Buffer.from(beforeGuide))},'PUT',422);
    assert.equal(await readFile(guidePath,'utf8'),beforeGuide);
   }
   await api('/workbench/content',{task_id:tid,path:'.\\body\\关键事实与承诺.md',content:current,base_hash:sha(Buffer.from(current))},'PUT');
   assert.equal((await state(tid)).build_preparation.promises,'ready');
   record('cross-platform-path-save-guard',{protected:true,windowsSaveRecorded:true});
   const savedCurrent=await readFile(path,'utf8');
   for(const invalidRow of ['| | 三年 | 用户确认 |','| 新承诺 |']){
    await api('/workbench/content',{task_id:tid,path:'.\\body\\关键事实与承诺.md',content:savedCurrent+'\n'+invalidRow,base_hash:sha(Buffer.from(savedCurrent))},'PUT',422);
    assert.equal(await readFile(path,'utf8'),savedCurrent);
   }
   record('invalid-promise-row-save-guard',{protected:true});
   await api('/workbench/content',{task_id:tid,path:'body/关键事实与承诺.md',content:servicePromises('7×24'),base_hash:sha(Buffer.from(savedCurrent))},'PUT');
   const saved=await readFile(path,'utf8');mode='pipe-leak';s=await settle(tid,await start(tid,'promises'));
   assert.equal(s.execution.state,'failed');assert.ok(s.execution.error.includes('电话支持|7×24小时 → 电话支持|5×8小时'));assert.equal(await readFile(path,'utf8'),saved);
   record('escaped-pipe-value-write-guard',{protected:true,differenceVisible:true});
  }
  // Invalid guides cannot acquire a ready stamp.
  mode='normal';const invalidId=await seed();await writeFile(join(dataRoot,'workspace',invalidId,'work/body/写作指引.md'),'# invalid guide, no chapter table');
  const validation=await business(runtime.ctx,'tool',{name:'validate_body',parameters:{section:'body/写作指引.md'}},{taskId:invalidId});assert.match(validation,/校验未通过/);
  await assert.rejects(business(runtime.ctx,'tool',{name:'build_preparation',parameters:{stage:'guide'}},{taskId:invalidId}),/校验未通过/);assert.notEqual((await state(invalidId)).build_preparation.guide,'ready');record('guide-validation-before-ready-guard',{protected:true});
 }catch(error){
  if(real&&realRun){const runtime=ctx.get('bidBusiness');const snapshot=await business(runtime.ctx,'state',{task_id:realTask});const handle=runtime.handles.get(realRun.session_id);record('real-model-incomplete',{error:error.message,elapsedMs:Date.now()-realStarted,preparation:snapshot.build_preparation,sections:snapshot.body_sections,toolCalls:handle.agent.session.snapshotEvents().filter(e=>e.type==='tool/call').map(e=>e.data.name)});await runtime.stop(realTask,realRun.session_id)}
  console.error(error);throw error;
 }finally{
  if(real&&realTask){const output=join(dirname(reportPath),basename(reportPath,'.json')+'-files');await mkdir(output,{recursive:true});await cp(join(dataRoot,'workspace',realTask,'work/body'),output,{recursive:true});}
  await writeFile(reportPath,JSON.stringify({candidate,model:real?'mlx-community/Qwen3.8-27B-4bit':'deterministic engineering fixture',results,requestCount,realCount,modelRequests},null,2));
  await ctx?.fiber.dispose();endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
 }
});
