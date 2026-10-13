// Real local model + production Web APIs, with fictional identities only in a disposable application.
import {cp,mkdtemp,mkdir,symlink,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
if(!process.env.P5_ISOLATED){
 const resume=process.argv[2]==='--resume';
 const previous=resume?JSON.parse(await readFile(join(root,'docs/evidence/library-p5-20261012/report.json'),'utf8')):null;
 const temporary=resume?previous.isolatedRoot:await mkdtemp(join(tmpdir(),'bidv4-library-p5-'));
 if(resume&&!temporary.includes('bidv4-library-p5-'))throw new Error('Only the recorded disposable application can resume');
 for(const dir of ['server','shared','scripts'])await cp(join(root,dir),join(temporary,dir),{recursive:true});
 for(const file of ['package.json','package-lock.json','cordis.patch.yml'])await cp(join(root,file),join(temporary,file));
 if(!resume)for(const dir of ['node_modules','dist','business'])await symlink(join(root,dir),join(temporary,dir),'dir');
 const child=spawn(process.execPath,['scripts/verify-library-p5.mjs'],{cwd:temporary,env:{...process.env,P5_ISOLATED:'1',P5_RESUME:resume?'1':'0',P5_SOURCE_ROOT:root,DSH_HOME:join(temporary,'dsh-home'),DSH_TELEMETRY_DISABLED:'1'},stdio:'inherit'});
 const code=await new Promise(r=>child.once('close',r));process.exitCode=code;
}else{
 const original=process.env.P5_SOURCE_ROOT,output=join(original,'docs/evidence/library-p5-20261012');await mkdir(output,{recursive:true});
 const resume=process.env.P5_RESUME==='1';
 const report=resume?JSON.parse(await readFile(join(output,'report.json'),'utf8')):{started:new Date().toISOString(),isolatedRoot:root,identityMode:'用户授权编造的验收演示主体与承诺；不作为真实企业事实，不进入正式库',model:'mlx-community/Qwen3.8-27B-4bit',thinking:false,maxTokensPerRequest:16384,stages:[]};
 if(resume){report.continuations??=[];report.continuations.push({time:new Date().toISOString(),reason:report.error});delete report.error;report.completed=false}
 const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 let ctx,timer,tid;
 try{
  const profile=join(process.env.DSH_HOME,'profiles/web');await mkdir(join(profile,'node_modules'),{recursive:true});
  if(!resume)await symlink(root,join(profile,'node_modules/ooo-bidpliot'),'dir');if(!resume)await symlink(join(root,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{'ooo-bidpliot':'file:'+root},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','ooo-bidpliot'],patchReload:'manual'}}}));
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'p5-local',model:report.model}},{id:'llm-pi-ai',config:{providers:{'p5-local':{api:'openai-completions',reasoning:'off',apiKeyEnv:'P5_MODEL_KEY',baseURL:'http://127.0.0.1:8000/v1',models:[{id:report.model,name:'P5 local real model',contextWindow:131072,maxTokens:16384,reasoningEfforts:{off:null,minimal:'low'},compat:{thinkingFormat:'chat-template',chatTemplateKwargs:{enable_thinking:false},supportsReasoningEffort:false},input:['text','image']}],retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'web-runtime',config:{openBrowser:false,printUrl:false,surfaceContext:true,trustedHosts:[]}},{id:'session-title-llm',disabled:true}]));
  process.env.P5_MODEL_KEY='local-demo';
  const {loadLayeredEnv}=await import('@deepseek-ai/dsh-app-boot');const {runProfile}=await import(join(root,'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'));
  ({ctx}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'web',patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','3096']}));
  const runtime=ctx.get('bidBusiness'),base='http://127.0.0.1:'+ctx.webServer.port;
  report.url=base;await writeFile(join(output,'browser-url.txt'),ctx.connection.authenticatedUrl(base));
  const login=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual'}),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  async function api(path,body,method=body?'POST':'GET'){
   const response=await fetch(base+'/api/bidv4'+path,{method,headers:{Cookie:cookie,Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   const value=await response.json();if(!response.ok)throw new Error(JSON.stringify({path,status:response.status,value}));return value;
  }
  const state=()=>api('/page-flow/'+tid);
  const record=async(name,details={})=>{report.stages.push({name,time:new Date().toISOString(),...details});await save();console.log('P5 '+name+' '+JSON.stringify(details))};
  const upload=async(path,file)=>{const data=new FormData();data.set('file',new Blob([await readFile(file)]),file.split('/').at(-1));return api(path,data)};
  if(!resume){
  const task=(await api('/tasks',{title:'P5 验收演示 · 真实赣州银行招标文件 · 非正式投标',request_id:randomUUID()})).task;tid=task.id;report.taskId=tid;
  const company=await api('/library/companies',{name:'杭州研数科技有限公司（验收演示）',credit_code:'DEMO-ONLY-20261012',note:report.identityMode,profile:{registered_address:'杭州市滨江区演示路100号（验收演示）',address:'杭州市滨江区演示路100号（验收演示）',phone:'0571-00000000（验收演示）',fax:'无',email:'bid@example.test',legal_name:'陈演示',legal_title:'总经理',bank_name:'演示银行',bank_account:'DEMO-0001'}});
  const rep=await api('/library/representatives',{company_id:company.id,name:'王验收',title:'投标负责人',phone:'0571-00000001（验收演示）',email:'representative@example.test',note:'仅用于软件流程验收，非真实授权'});
  await record('维护主体与授权代表',{companyId:company.id,representativeId:rep.id});
  const cert=await upload('/kb/files?company_id='+company.id,join(original,'data/workspace/knowledge/files/图片1.png'));
  for(let n=0;n<240;n++){
   const item=await api('/kb/items/'+cert.id);
   if(item.parse_status==='failed')throw new Error('真实图片识别失败：'+item.error);
   if(item.parse_status==='ready'&&item.extract_status==='done'){
    await api('/kb/items/'+cert.id,{revision:item.revision,company_id:company.id,title:'2015年开户许可证（历史参考，验收演示）',business:{...item.business,statement:(item.business?.statement??'')+' 本文件是2015年历史资料；本次归属仅用于隔离验收，不证明演示公司的现行资质。'},text:null},'PUT');await record('真实图片OCR与结构化识别、核对保存',{assetId:cert.id,fields:Object.keys({...item.business?.fields,...item.business?.extra})});break;
   }
   if(n===239)throw new Error('图片识别超过20分钟');await new Promise(r=>setTimeout(r,5000));
  }
  const material=await upload('/materials/files',join(original,'data/workspace/materials/files/服务方案.docx'));
  const outline=await api('/materials/files/'+material.id+'/outline');assert.equal(outline.parse_status,'ready');
  const content=execFileSync(join(root,'business/python/.venv/bin/python'),['-c',`from pathlib import Path;print(len(Path(${JSON.stringify(join(root,'data/workspace/materials/parse/服务方案.docx/服务方案.docx.md'))}).read_text().splitlines()))`],{encoding:'utf8'}).trim();
  const block=await api('/materials/files/'+material.id+'/blocks',{title:'真实数据处理服务说明（验收复用）',note:'用于外部数据服务技术方案；仅拷贝适用章节，历史企业、客户、项目名称与承诺必须修订',ranges:[[1,Number(content)]]});
  const search=await api('/materials/blocks?q='+encodeURIComponent('数据')+'&page=1&page_size=5');assert.ok(search.total>0);await record('真实写作素材上传、建块、全文检索与分页',{fileId:material.id,blockId:block.id,total:search.total});
  await api('/projects/'+tid+'/bidder',{company_id:company.id,signer_id:rep.id,sign_date:'2026-08-19',revision:0},'PUT');
  const source=join(original,'data/workspace/t_4d085c62c1884b5594cd69c99ca006ab/sources/招标文件-（定稿）JXYJ2026-GZYH-G005-1赣州银行2026年度外部数据供应商入围采购项目.docx');
  await upload('/files?task_id='+tid,source);const sourceName=source.split('/').at(-1);
  await api('/page-flow/'+tid+'/sources',{main_file:sourceName,supplements:[],input_version:(await state()).input_versions.analyse},'PUT');
  }else{tid=report.taskId;await record('从已保存准备和正文断点续跑')}
  const sourceName='招标文件-（定稿）JXYJ2026-GZYH-G005-1赣州银行2026年度外部数据供应商入围采购项目.docx';
  const demo='本项目仅在隔离环境验收，用户授权编造演示信息；不用于正式投标。主体与代表值以已确认快照为准，所有生成文件应明确验收演示。项目承诺以招标要求最低值作为演示值，金额、人力等可给合理演示值并标注验收演示。缺少真实证据的资质业绩不得据旧许可证声称有效，标批注待正式补证。技术方案使用全库服务方案素材中适用区间，实际调用注入、项目化修订和旧名称扫描工具，保留至少一张适用表格和一张素材图片用于验证。缺少原件的附件也必须建立对应 Word 说明节，写清“验收演示，未提供真实凭证，正式投标前待补”，使用 docx_comment_add 留待办；不得伪造证照、身份证或银行凭证，也不要把这些目录节点留成 missing。续作只完成当前 missing/draft 节并合册，所有 ready 节必须保持文件字节不变。';
  async function settle(run){
   for(let n=0;n<30;n++){
    const handle=runtime.handles.get(run.session_id);await handle.agent.whenIdle();await runtime.settling.get(tid);let s=await state();
    if(s.execution.state!=='needs_input')return s;
    await record('等待补充并同会话续接',{kind:s.execution.kind,questions:s.execution.questions.flatMap(b=>b.questions.map(q=>q.question))});
    await api('/page-flow/'+tid+'/answer',{session_id:run.session_id,call_ids:s.execution.questions.map(q=>q.callId),batches:s.execution.questions.map(b=>({call_id:b.callId,answers:b.questions.map(q=>({id:q.id,selected:q.options?.length?[q.options[0].label]:[],custom:demo+' 请继续完整流程。签署日期2026-08-19；服务响应2小时、维护三年、拟投入5人、价格100000元均为验收演示。'}))}))});
   }
   throw new Error('问答超过30轮');
  }
  async function phase(kind,extra={}){
   const s=await state();const run=await api('/page-flow/'+tid+'/action',{kind,request_id:randomUUID(),input_version:s.input_versions[kind],main_file:sourceName,supplements:[],acceptance_note:demo,...extra});
   await record(kind+'开始',{sessionId:run.session_id});const result=await settle(run);await writeFile(join(output,kind+'-state.json'),JSON.stringify(result,null,2));await record(kind+'结束',{state:result.execution.state,error:result.execution.error,sections:result.body_sections.map(x=>({title:x.title,status:x.status})),volumes:result.volume_states});
   if(result.execution.state!=='completed')throw new Error(kind+'未完成：'+result.execution.error);return result;
  }
  timer=setInterval(()=>void state().then(async s=>{report.progress={time:new Date().toISOString(),execution:s.execution,sections:s.body_sections,volumes:s.volume_states};await save()}).catch(()=>{}),15000);timer.unref();
  if(!resume){await phase('analyse');await phase('outline',{page_target:20,numbering:'decimal'})}
  const {createHash}=await import('node:crypto');
  const readyBefore=Object.fromEntries((await state()).body_sections.filter(s=>s.status==='ready').map(s=>[s.path,execFileSync(join(root,'business/python/.venv/bin/python'),['-c',`import hashlib;print(hashlib.sha256(open(${JSON.stringify(join(root,'data/workspace',tid,'work',s.path))},'rb').read()).hexdigest())`],{encoding:'utf8'}).trim()]));
  let result=await state();
  if(result.body_sections.some(s=>s.status!=='ready'))result=await phase('build');
  for(const [path,hash] of Object.entries(readyBefore))assert.equal(createHash('sha256').update(await readFile(join(root,'data/workspace',tid,'work',path))).digest('hex'),hash,'继续制作不能覆盖已校验的正文');
  await record('继续制作保留已完成章节',{preserved:Object.keys(readyBefore)});assert.ok(result.body_sections.length>0);assert.ok(result.body_sections.every(s=>s.status==='ready'));
  const letter=result.body_sections.find(s=>s.title==='投标函');
  if(letter)await phase('revise',{sections:[letter],instruction:'本次明确授权只重建投标函：使用 docx_section_create replace=true 清理现有重复副本，再 docx_source_inject 拷入本招标原文 L551-L573 的投标函格式，然后逐项填写。签字代表必须是确认快照中的王验收（投标负责人），签字栏不能填陈演示；陈演示仅为法人档案事实。地址、电话、传真、邮箱必须逐字使用确认快照中的完整值（含“验收演示”标注），不得省略标注。签署日期2026年8月19日，保证金人民币1000元（壹仟元整）。致送方只能出现一次，完整保留原文声明条款，不自拟另一份投标函。缺少实际签字盖章留待办批注。完成后校验本章，不改其他章节和承诺清单。'});
  const technical=result.body_sections.find(s=>/技术|方案/.test(s.title))??result.body_sections[0];
  const beforeRevision=Object.fromEntries(await Promise.all(result.body_sections.map(async s=>[s.path.split('/').at(-1),createHash('sha256').update(await readFile(join(root,'data/workspace',tid,'work',s.path))).digest('hex')])));
  await writeFile(join(output,'before-revise-hashes.json'),JSON.stringify({time:Date.now(),hashes:beforeRevision},null,2));
  await phase('revise',{sections:[technical],instruction:'完善本章的质量复核措施：数据交付前双人复核，并记录两名复核人的签收和差异关闭结果。措施明确标注“验收演示”。已有质量复核段落时修改该段，不重复追加。不要修改其他章节或已确认承诺。'});
  for(const [name,hash] of Object.entries(beforeRevision))if(name!==technical.path.split('/').at(-1))assert.equal(createHash('sha256').update(await readFile(join(root,'data/workspace',tid,'work/body',name))).digest('hex'),hash,'单章修订不能改动其他正文');
  const checks=await api('/page-flow/'+tid+'/checks');await writeFile(join(output,'checks.json'),JSON.stringify(checks,null,2));await record('审查实际正文',{hasBody:checks.has_body});
  result=await state();await api('/page-flow/'+tid+'/export',{input_version:result.input_versions.revise});
  result=await state();assert.ok(result.volume_states.every(v=>v.status==='ready'));
  for(const volume of result.volume_states){const url=base+'/api/bidv4/artifacts/'+volume.artifact_id+'/file';const r=await fetch(url,{headers:{Cookie:cookie}});assert.ok(r.ok);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');await writeFile(join(output,'验收演示-'+volume.name+'.docx'),bytes)}
  await cp(join(root,'data/workspace',tid,'work'),join(output,'work'),{recursive:true});await cp(join(root,'data/dsh/sessions'),join(output,'sessions'),{recursive:true});
  report.finalState=result;report.completed=true;await record('合册发布与真实DOCX下载',{volumes:result.volume_states});
 }catch(error){if(tid)await cp(join(root,'data/workspace',tid,'work'),join(output,'work'),{recursive:true}).catch(()=>{});report.completed=false;report.error=error.stack;await save();console.error('P5 FAILED '+error.message);process.exitCode=1}
 finally{clearInterval(timer);if(ctx){await ctx.get('bidBusiness')?.close();await ctx.fiber.dispose()}}
}
