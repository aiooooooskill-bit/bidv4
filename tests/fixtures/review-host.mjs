// Disposable dsh profile and project data; only synthetic documents and a local model fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root,dataRoot,business} from '../../server/native/business.mjs';
import {loadLayeredEnv} from '@deepseek-ai/dsh-app-boot';
import {runProfile} from '@deepseek-ai/dsh/profile-boot';
if(process.env.BIDV4_REVIEW_PIPELINE_FIXTURE!=='1')throw Error('Review fixture requires the isolated test runner');
const home=await mkdtemp(join(tmpdir(),'bid-review-dsh-'));
process.env.DSH_HOME=home;process.env.DSH_TELEMETRY_DISABLED='1';process.env.REVIEW_FIXTURE_KEY='isolated-fixture-only';
const headers=JSON.parse(execFileSync(join(root,'business/python/.venv/bin/python'),['-c','import sys,json;sys.path.insert(0,sys.argv[1]);from app.tools.validate_analysis import _REQUIRED_HEADERS;print(json.dumps(_REQUIRED_HEADERS))',join(root,'business/python')],{encoding:'utf8'}));
const reqs=['文件须包含投标函，缺少投标函将被否决。','投标人须提供营业执照复印件。','文件按资格文件、技术文件、报价文件三个部分组织。','团队至少四名人员，每增加一人得一分。','维护服务期限三年。','系统须支持接口加密传输。','投标有效期90天。'];
const bids=['已提供投标函。','已提供营业执照复印件。','本文件按资格文件、技术文件、报价文件三个部分组织。','团队共三名人员。','维护服务期限一年。','系统支持接口加密传输。','投标有效期90天。'];
const checks=[];let ctx,mode='normal',entered;
const sha=b=>createHash('sha256').update(b).digest('hex');
const call=(name,args)=>({name,args});
function citation(d,term){const lines=d.content.split('\n'),i=lines.findIndex(l=>l.includes(term));assert.ok(i>=0,term);return {document_id:d.id,start:i+1,end:i+1}}
function notes(docs){
 const tender=docs.find(d=>d.kind==='tender'),mapping={structure:[2],'requirements-qualification':[1],'requirements-submission':[6],'requirements-business':[4,5],'requirements-format':[2],disqualification:[0],evaluation:[3],clarifications:[]};
 return Object.entries(headers).map(([key,tables])=>{let content='';for(const header of tables){content+='| '+header.join(' | ')+' |\n| '+header.map(()=> '---').join(' | ')+' |\n';for(const i of mapping[key]){const row=header.map((h,j)=>/出处/.test(h)?tender.name+' L'+citation(tender,reqs[i]).start:j===0&&key!=='requirements-business'?String(i+1):reqs[i]);content+='| '+row.join(' | ')+' |\n';}content+='\n';}if(key!=='clarifications')content+='## coverage 声明\n已检查：夹具双方对应章节；未检查：图片真实性\n';if(key==='disqualification')content+='反查词表：废标、无效、否决\n';return {key,content};});
}
const endpoint=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);
  const text=request.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const cwd=text.match(/当前任务绝对路径：([^；]+)；/)[1];
  const latest=request.messages.findLastIndex(m=>m.role==='user'&&String(typeof m.content==='string'?m.content:JSON.stringify(m.content)).includes('页面输入：'));
  const step=request.messages.slice(latest+1).filter(m=>m.role==='assistant'&&m.tool_calls?.length).length;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(mode==='stop'){res.write(': waiting for stop\n\n');entered?.();return}
  let calls=[];
  if(mode!=='no-report'){
   if(step===0)calls=[call('prepare_review_documents',{}),call('read',{file_path:'skills/tender-review/SKILL.md'}),call('read',{file_path:'skills/_shared/evidence-rules.md'})];
   const toolResult=request.messages.find(m=>m.role==='tool'&&String(m.content).includes('outline_path'));
   const docs=toolResult?JSON.parse(String(toolResult.content)).documents:[];
   if(step===1)calls=docs.flatMap(d=>[call('read',{file_path:d.outline_path}),call('read',{file_path:d.path})]);
   if(step===2){for(const d of docs)d.content=await readFile(d.path,'utf8');calls=notes(docs).map(n=>call('write',{file_path:join(cwd,'work/review/analysis',n.key+'.md'),content:n.content}));}
   if(step===3)calls=[call('review_basis',{stage:'validate'})];
   if(step===4)calls=[call('review_batch',{})];
   if(step>=5){
    for(const d of docs)d.content=await readFile(d.path,'utf8');
    const last=request.messages.findLast(m=>m.role==='tool');let value;try{value=JSON.parse(last.content)}catch{}
    const batch=value?.next??value;
    if(batch?.complete)calls=[call('finish_review_report',{summary:'工程夹具发现团队人数及维护年限两项差异。',limitations:['工程夹具；签字及图片真实性须人工确认。']})];
    else if(batch?.batch_id){
     const bid=docs.find(d=>d.kind==='bid');
     const results=batch.requirements.map(r=>{const i=reqs.findIndex(t=>r.text.includes(t));assert.ok(i>=0);return {slot:r.slot,tender:r.tender.map(({document_id,start,end})=>({document_id,start,end})),status:[3,4].includes(i)?'conflict':'responded',assessment:'已检查双方对应章节和后文，双方响应'+([3,4].includes(i)?'不一致':'一致')+'。',bid:[citation(bid,bids[i])],problems:[3,4].includes(i)?[{risk_type:i===3?'scoring':'suggestion',title:i===3?'团队人数不足':'维护年限冲突',explanation:'双方原文存在差异。',suggestion:'核对并修改。'}]:[]}});
     if(mode==='bad-evidence')results[0].bid[0].end=999999;
     calls=mode==='scope-leak'?[call('write',{file_path:join(cwd,'work/body/审查章节.docx'),content:'越界修改'})]:[call('save_review_batch',{batch_id:batch.batch_id,results})];
    }
   }
  }
  const delta=calls.length?{tool_calls:calls.map((c,index)=>({index,id:'review-'+step+'-'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'本机技术夹具执行结束。'};
  for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'review-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error)}
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
try{
 const profile=join(home,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});await symlink(root,join(profile,'node_modules/ooo-bidpliot'),'dir');await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
 await writeFile(join(profile,'package.json'),JSON.stringify({name:'review-isolated-profile',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
 await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},{id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'REVIEW_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'本机审查夹具',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},{id:'session-title-llm',disabled:true}]));
 ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));
 let runtime=ctx.get('bidBusiness'),base='http://127.0.0.1:'+ctx.webServer.port;
 let login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
 async function api(path,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const value=await response.json();assert.ok(expected===200?response.ok:response.status===expected,JSON.stringify({path,status:response.status,value}));return value}
 const state=tid=>api('/page-flow/'+tid);
 const record=(name,details={})=>{checks.push({name,pass:true,...details});console.log('PASS '+name)};
 async function seed(external){
  const {task}=await api('/tasks',{title:external?'外部审查技术验证':'平台制作审查技术验证',request_id:randomUUID()});
  const folder=join(dataRoot,'workspace',task.id),tender=join(folder,'sources/工程招标.docx'),bid=join(folder,external?'sources/外部投标.docx':'work/body/审查章节.docx');
  execFileSync(join(root,'business/python/.venv/bin/python'),['-c','from docx import Document;import json,sys;\nfor path,lines in json.loads(sys.argv[1]):\n d=Document();d.add_heading("工程审查项目（合成材料）",0)\n for i,text in enumerate(lines):\n  d.add_heading("核查章节"+str(i+1),1);d.add_paragraph(text)\n d.add_paragraph("本材料仅用于隔离技术验证，核对输入角色、真实解析、报告保存和版本变化，不用于正式投标。"*3);d.save(path)',JSON.stringify([[tender,reqs],[bid,bids]])]);
  for(const file of [tender,...(external?[bid]:[])]){const form=new FormData();form.append('file',new Blob([await readFile(file)]),file.split('/').at(-1));await api('/files?task_id='+task.id,form)}
  let s=await state(task.id);s=await api('/page-flow/'+task.id+'/sources',{main_file:'工程招标.docx',supplements:[],input_version:s.input_versions.analyse},'PUT');
  if(external)await api('/page-flow/'+task.id+'/review-input',{bids:['外部投标.docx'],input_version:s.input_versions.review},'PUT');
  else{
   await mkdir(join(folder,'_meta/staging'),{recursive:true});const draft=join(folder,'_meta/staging/review-directory.json');await writeFile(draft,JSON.stringify({response_documents:[{name:'技术标',directory:[{目录名称:'审查章节',level:1,children:[]}]}]}));
   const result=await business(runtime.ctx,'tool',{name:'publish_artifact',parameters:{contract:'tender.directory/tender-response-docs@1',draft_path:draft}},{taskId:task.id,sessionId:'seed'});assert.match(result,/发布成功/);
  }
  return task.id;
 }
 async function start(tid,request_id=randomUUID(),input_version){const s=await state(tid);const payload={kind:'review',request_id,input_version:input_version??s.input_versions.review};const run=await api('/page-flow/'+tid+'/action',payload);return {run,payload}}
 async function settle(tid,run){await runtime.handles.get(run.session_id).agent.whenIdle();await runtime.settling.get(tid);return state(tid)}
 for(const task of (await api('/tasks')).tasks){if(!['外部审查技术验证','平台制作审查技术验证'].includes(task.title))throw Error('Unexpected project in verification data; will not alter it');await api('/tasks/'+task.id,undefined,'DELETE')}
 const external=await seed(true),platform=await seed(false);
 for(const tid of [external,platform]){
  const before=await state(tid),files=before.review.mode==='external'?join(dataRoot,'workspace',tid,'sources/外部投标.docx'):join(dataRoot,'workspace',tid,'work/body/审查章节.docx'),hash=sha(await readFile(files));
  assert.equal(before.review.status,'unreviewed');const {run,payload}=await start(tid);const replay=await api('/page-flow/'+tid+'/action',payload);assert.equal(replay.session_id,run.session_id);assert.equal(replay.replayed,true);
  const handle=runtime.handles.get(run.session_id);assert.equal(handle.agent.options.maxTokens,32768);const tools=runtime.ctx.tools.schemas(handle.agent).map(t=>t.name);assert.ok(tools.includes('save_review_batch'));assert.ok(tools.includes('skill'));assert.ok(tools.includes('review_basis'));assert.ok(!tools.includes('docx_section_create'));
  const s=await settle(tid,run);assert.equal(s.execution.state,'completed',s.execution.error);assert.equal(s.review.status,'reviewed');assert.equal(s.review.report.report.issues.length,2);assert.deepEqual(s.review.report.report.issues.map(i=>i.risk_type).sort(),['scoring','suggestion']);assert.ok(s.review.report.audit);assert.equal(sha(await readFile(files)),hash);
  assert.ok(s.review.report.report.requirements.every(r=>r.tender.length&&r.bid.length));assert.equal(s.review.report.report.coverage.length,7);assert.equal(s.review.report.analysis.catalog.length,9);assert.ok(s.review.report.analysis.validation.startsWith('[校验通过]'));record(before.review.mode+' LingYan parse→analysis validation→full catalog comparison→original checks→report',{session:run.session_id,sourceUnchanged:true,requirements:9,issues:2,replay:true});
 }
 const reviewed=await state(external),issueId=reviewed.review.report.report.issues[0].id;await api('/page-flow/'+external+'/review-decision',{session_id:reviewed.review.report.session_id,issue_id:issueId,status:'confirmed',note:'夹具已人工复核'},'PUT');assert.equal((await state(external)).review.report.decisions[issueId].status,'confirmed');record('manual review persisted');
 const source=join(dataRoot,'workspace',external,'sources/外部投标.docx');execFileSync(join(root,'business/python/.venv/bin/python'),['-c','from docx import Document;import sys;d=Document(sys.argv[1]);d.add_paragraph("投标文件版本变化");d.save(sys.argv[1])',source]);assert.equal((await state(external)).review.status,'stale');await api('/page-flow/'+external+'/action',{kind:'review',request_id:randomUUID(),input_version:reviewed.input_versions.review},'POST',409);record('changed document returns pending and rejects old basis');
 for(const invalid of ['no-report','bad-evidence','scope-leak']){mode=invalid;const before=sha(await readFile(source)),{run}=await start(external),s=await settle(external,run);assert.equal(s.execution.state,'failed');assert.equal(s.review.status,'failed');assert.equal(sha(await readFile(source)),before);record(invalid+' cannot mark reviewed')}
 mode='stop';const enteredPromise=new Promise(resolve=>entered=resolve),started=await start(external);await enteredPromise;await api('/page-flow/'+external+'/stop',{session_id:started.run.session_id});assert.equal((await state(external)).review.status,'stopped');record('stop cannot mark reviewed');
 mode='normal';await settle(external,(await start(external)).run);const pending=await seed(true);const all=await api('/tasks');assert.equal(all.tasks.find(t=>t.id===pending).review_status,'unreviewed');assert.equal(all.tasks.find(t=>t.id===platform).review_status,'reviewed');record('list distinguishes pending and reviewed');
 const checkpoint=(await state(platform)).review.report;for(const file of await (await import('node:fs/promises')).readdir(join(dataRoot,'actions',platform))){const p=join(dataRoot,'actions',platform,file);const record=JSON.parse(await readFile(p,'utf8'));if(record.session_id===checkpoint.session_id){delete record.finished_state;await writeFile(p,JSON.stringify(record))}}const savedReport=join(dataRoot,'workspace',platform,'work/review/runs',checkpoint.session_id+'.json');const candidate=JSON.parse(await readFile(savedReport,'utf8'));candidate.completed=false;await writeFile(savedReport,JSON.stringify(candidate));
 await ctx.fiber.dispose();({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']}));runtime=ctx.get('bidBusiness');base='http://127.0.0.1:'+ctx.webServer.port;login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'});cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');assert.equal((await state(platform)).review.status,'reviewed');assert.equal((await state(external)).review.status,'reviewed');record('host restart retains report and reconciles interrupted completion checkpoint');
 console.log('Review pipeline assertions completed: '+checks.length);
}catch(error){console.error(error);throw error}finally{await ctx?.fiber.dispose();endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));await rm(home,{recursive:true,force:true})}
