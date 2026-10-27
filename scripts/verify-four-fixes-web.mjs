import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,symlink,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'bidv4-four-fixes-web-')),app=join(temporary,'app'),home=join(temporary,'dsh-home'),evidence=join(root,'outputs/four-fixes-web-20261027');
await mkdir(app);await mkdir(evidence,{recursive:true});
for(const directory of ['server','shared'])await cp(join(root,directory),join(app,directory),{recursive:true});
for(const file of ['package.json','package-lock.json','cordis.patch.yml','cordis.web.patch.yml'])await cp(join(root,file),join(app,file));
for(const directory of ['business','dist','src','node_modules'])await symlink(join(root,directory),join(app,directory),'dir');
const categories=['structure','requirements-qualification','requirements-submission','requirements-business','requirements-format','disqualification','evaluation','clarifications'],modelRequests=[],errors=[];
const endpoint=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);modelRequests.push({model:request.model});
 const instruction=message=>message.role==='user'?(typeof message.content==='string'?message.content:JSON.stringify(message.content)):message.role==='tool'?(()=>{try{return JSON.parse(message.content).instructions??''}catch{return ''}})():'';
 const index=request.messages.findLastIndex(message=>instruction(message).includes('页面输入：')),text=index<0?'':instruction(request.messages[index]),payload=JSON.parse(text.match(/页面输入：(\{[^\n]+\})/)?.[1]??'{}'),cwd=text.match(/当前任务绝对路径：([^；\r\n]+)/)?.[1],messages=request.messages.slice(Math.max(index,0)),step=messages.filter(message=>message.role==='assistant'&&message.tool_calls?.length).length;
 let calls=[];if(payload.kind==='analyse'&&step===0)calls=[payload.main_file,...payload.supplements].map(file=>({name:'parse_document',args:{file_name:file}}));
 if(payload.kind==='analyse'&&step===1)calls=categories.map(name=>({name:'write',args:{file_path:join(cwd,'work/analysis',name+'.md'),content:'# 工程验证 '+name+'\n\n本文件仅用于验证来源上传、原表解析、阶段复用与网页交互，不构成真实招标解读。项目采购内容及原文依据以本次解析文件为准。'}}));
 const call=(name,args)=>({name,args}),write=(path,content)=>call('write',{file_path:join(cwd,'work',path),content});
 if(payload.kind==='outline'){
  const titles=['封面','目录','工程验证章节'],outline='# 响应文件：工程验证册\n\nscope：本机工程流程验收\n\n## 目录\n'+titles.map(t=>'- '+t).join('\n')+'\n\n## 来源标注\n\n## 目录说明\n- 目录 :: 交付形态=模板或附件填充 | 归位理由=合册机械生成目录页 | 理由来源= | 概述=由Word目录域生成本册章节清单。\n';
  calls=[[call('outline_plan',{operation:'complete',volume:'工程验证册',root_titles:titles.join('\n')})],[write('outline/tender-response-docs.md',outline)],[call('check_outline',{})],[call('assemble_tender',{})]][step]??[];
 }
 if(payload.kind==='build'){
  calls=[
   [call('build_preparation',{})],
   [write('body/写作指引.md','# 写作指引\n\n| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 封面 | 推理撰写 | — | — | 无 |\n| 目录 | — | — | — | 合册时自动生成 |\n| 工程验证章节 | 推理撰写 | — | — | 无 |')],
   [call('validate_body',{section:'body/写作指引.md'})],
   [call('build_preparation',{stage:'guide'})],
   [write('body/关键事实与承诺.md','# 关键事实与承诺\n\n| 事项 | 值 |\n|---|---|\n| 验收方式 | 本机工程验收 |')],
   [call('build_preparation',{stage:'promises'})],
   [call('docx_section_create',{path:'body/封面.docx',title:'封面',paragraphs:'工程验证册，本机软件测试的虚构封面。'}),call('docx_section_create',{path:'body/工程验证章节.docx',title:'工程验证章节',paragraphs:'本文件仅用于本机流程验收。'+('本次工程验证使用合成文件检查真实工具、项目版本、主体信息及合册流程，不构成真实投标响应或承诺。'.repeat(6))})],
   [call('validate_body',{section:'body/封面.docx'}),call('validate_body',{section:'body/工程验证章节.docx'})],
   [call('check_pipeline_state',{}),call('validate_body',{section:'body'}),call('docx_assemble_volume',{})],
  ][step]??[];
 }
 const delta=calls.length?{tool_calls:calls.map((call,index)=>({index,id:randomUUID(),type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))}:{content:'工程验证阶段完成。'};
 res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [chunk,finish]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:chunk,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n');
}catch(error){errors.push(error.stack);res.destroy(error)}});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
const profile=join(home,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});await symlink(app,join(profile,'node_modules/ooo-bidpliot'),'dir');await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
await writeFile(join(profile,'package.json'),JSON.stringify({name:'source-web-verification',private:true,dependencies:{'ooo-bidpliot':'file:'+app},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));await writeFile(join(profile,'cordis.yml'),'[]\n');
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'fixture',model:'fixture'}},{id:'llm-pi-ai',config:{providers:{fixture:{api:'openai-completions',apiKeyEnv:'SOURCE_WEB_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+endpoint.address().port+'/v1',models:[{id:'fixture',name:'本机流程验证',contextWindow:131072,input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'session-title-llm',disabled:true}]));
const child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',join(app,'cordis.web.patch.yml'),'--no-open','--host','127.0.0.1','--port','3089'],{cwd:app,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',SOURCE_WEB_FIXTURE_KEY:'local-fixture-only'},stdio:['ignore','pipe','pipe']});
let output='';const login=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('dsh web启动超时：'+output.replace(/([?&]token=)[^\s]+/g,'$1[redacted]'))),25000);const collect=bytes=>{output+=bytes;const url=output.match(/http:\/\/127\.0\.0\.1:3089\/\?token=[^\s]+/)?.[0];if(url){clearTimeout(timer);resolve(url)}};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('exit',code=>{clearTimeout(timer);reject(Error('dsh web退出 '+code+' '+output.replace(/([?&]token=)[^\s]+/g,'$1[redacted]')))})});
const base='http://127.0.0.1:3089',authenticated=await fetch(login,{redirect:'manual'}),cookie=authenticated.headers.getSetCookie().map(value=>value.split(';')[0]).join(';');
async function api(path,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const value=await response.json();assert.ok(expected===200?response.ok:response.status===expected,JSON.stringify({path,status:response.status,value}));return value}
const checks=[],record=(name,details={})=>{checks.push({name,pass:true,...details});console.log('PASS '+name)};
const assets=join(temporary,'assets');await mkdir(assets);
execFileSync(join(root,'business/python/.venv/bin/python'),['-c',`from pathlib import Path\nfrom docx import Document\nfrom openpyxl import Workbook\np=Path(${JSON.stringify(assets)})\nd=Document();d.add_heading('工程验证招标',0);d.add_paragraph('采购服务器及存储设备，具体规格以技术清单为准。');d.save(p/'原始招标.docx')\nw=Workbook();s=w.active;s.title='设备清单';s.append(['编码','名称','数量','金额']);s.append(['00123','服务器',0,1234.5]);s['D3']='=SUM(D2)';s2=w.create_sheet('服务要求');s2.append(['要求','说明']);s2.append(['实施服务','部署上线']);s3=w.create_sheet('隐藏补充');s3.sheet_state='hidden';s3['A1']='隐藏要求';w.save(p/'技术清单.xlsx')\nw.active['B2']='更新设备';w.save(p/'新技术清单.xlsx')\n`]);
const upload=async(tid,name,path,extra='')=>{const form=new FormData();form.append('file',new Blob([await readFile(path)]),name);return api('/files?task_id='+tid+extra,form)};
const state=tid=>api('/page-flow/'+tid);
const waitState=async(tid,predicate)=>{const end=Date.now()+120000;while(Date.now()<end){const value=await state(tid);if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,300))}throw Error('等待项目状态超时')};
try{
 const {task}=await api('/tasks',{title:'四项修复 · 网页验收',request_id:randomUUID()}),tid=task.id;
 await upload(tid,'原始招标.docx',join(assets,'原始招标.docx'));await upload(tid,'时间与日期.xls',join(root,'tests/fixtures/excel/time-values-1900.xls'));
 const excel=await api('/files/'+encodeURIComponent('时间与日期.xls')+'/excel?task_id='+tid),cells=Object.fromEntries(excel.rows.map(row=>row.cells));
 assert.equal(cells['开始时间'],'12:00:00');assert.equal(cells['响应时长'],'0:30:00');assert.equal(cells['跨天时长'],'1 day, 12:00:00');assert.equal(cells['日期'],'2026-10-27');record('真实XLS预览正确区分钟点、时长与日期');
 const company=await api('/library/companies',{name:'网页验证主体',profile:{legal_name:'验证法人'}});await api('/projects/'+tid+'/bidder',{company_id:company.id,signer_id:'legal',sign_date:'2026-10-27',revision:0},'PUT');
 await api('/tasks/'+tid,{title:'后台保存的新名称',previous_title:task.title},'PATCH');await api('/tasks/'+tid,{title:'旧草稿覆盖',previous_title:task.title},'PATCH',409);assert.equal((await state(tid)).task.title,'后台保存的新名称');record('旧名称条件冲突时服务端拒绝覆盖');await api('/tasks/'+tid,{title:task.title,previous_title:'后台保存的新名称'},'PATCH');
 const plan=await api('/page-flow/'+tid+'/workflow-plan');await upload(tid,'技术清单.xlsx',join(assets,'技术清单.xlsx'));const callsBefore=modelRequests.length;
 await api('/page-flow/'+tid+'/workflow',{input_versions:plan.input_versions},'POST',409);await api('/page-flow/'+tid+'/workflow',{},'POST',422);assert.equal((await state(tid)).workflow,null);assert.equal(modelRequests.length,callsBefore);record('过期或缺失确认版本不登记流程、零模型调用');
 const freshPlan=await api('/page-flow/'+tid+'/workflow-plan');await api('/page-flow/'+tid+'/workflow',{input_versions:freshPlan.input_versions});
 const value=await waitState(tid,v=>['completed','failed'].includes(v.workflow?.state));assert.equal(value.workflow.state,'completed',JSON.stringify(value.workflow));assert.deepEqual(value.workflow.completed,['analyse','outline','build']);assert.equal(value.review.status,'unreviewed');assert.equal(value.review.report,null);assert.ok(value.volume_states.every(v=>v.status==='ready'));record('重新确认后默认流程真实完成合册，未生成审查报告');
 const records=await Promise.all((await readdir(join(app,'data/actions',tid))).filter(n=>n!=='latest.json').map(async n=>JSON.parse(await readFile(join(app,'data/actions',tid,n),'utf8'))));assert.equal(records.filter(r=>r.kind==='analyse').length,1);record('有效流程只执行一次解读');
 const otherTask=(await api('/tasks',{title:'用于触发列表刷新的项目',request_id:randomUUID()})).task;
 await writeFile(join(evidence,'summary.json'),JSON.stringify({host:'dsh web CLI',base,checks,modelRequests:modelRequests.length,errors,browserTask:tid,otherTask:otherTask.id},null,2));
 await writeFile(join(temporary,'control.json'),JSON.stringify({login,base,app,home,assets,evidence,browserTask:tid,otherTask:otherTask.id,pid:child.pid}));console.log('READY '+join(temporary,'control.json'));
}catch(error){console.error(error.stack);await writeFile(join(evidence,'failure.json'),JSON.stringify({error:error.stack,checks,errors,log:output.replace(/([?&]token=)[^\s]+/g,'$1[redacted]')},null,2));child.kill('SIGTERM');endpoint.close();process.exitCode=1}
process.on('SIGTERM',()=>{child.kill('SIGTERM');endpoint.close();setTimeout(()=>process.exit(),1000).unref()});
