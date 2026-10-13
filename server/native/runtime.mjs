import {mkdir,readFile,writeFile,rename,unlink,readdir,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {business,dataRoot,root,BusinessError} from './business.mjs';
import {transcribe,subagentFailure} from './tools.mjs';
import {analysisProgress} from '../../shared/analysis-progress.js';
import {installExecutionGuard} from './execution-guard.mjs';
import {jsonResponse} from './markdown.mjs';
const actions=join(dataRoot,'actions'),locks=join(dataRoot,'locks'),knowledgeJobs=join(dataRoot,'knowledge-jobs');
const requiredAnalysis=['structure.md','requirements-submission.md','requirements-business.md','requirements-qualification.md','evaluation.md','requirements-format.md','disqualification.md','clarifications.md'];
const instructions={review:'执行标书审查：先调用prepare_review_documents解析本次全部招标与投标文件，读双方大纲，再逐段读取原文。平台既有解读可复用但核对原文；外部投标不需要制作目录、写作指引或承诺清单。按废标条款、资格要求、格式与结构、评分标准、商务要求、技术要求逐项对照，全部文件都须阅读；输出要求清单、问题、六类实际核查范围和未覆盖事项。用save_review_report保存结构化报告，摘录与行号必须真实。无证据不能断言未提供，图片签章和外部真实性只能提示待确认；评分项不得夸大为废标。原文件、正文和解读不改写，不能调用制作工具。未完成章节或无法识别图像要在limitations声明。报告完成后停轮。',analyse:'按document-parse和tender-analysis技能解析页面指定的全部来源，完成八份解读文件。结束后停轮。',outline:'按tender-outline技能生成并发布单册或多册目录，结束后停轮。',guide:'按tender-body技能仅生成body/写作指引.md，结束后停轮。',promises:'按tender-body技能仅生成body/关键事实与承诺.md，未提供的具体承诺值向页面提问，结束后停轮。',body:'按tender-body技能生成页面所选章节。先读取build_preparation，复用ready规划，只补齐缺失准备；生成指引后校验并记录guide，整理承诺后记录promises。具体缺值集中ask_user_question，页面答复后同会话继续。已有承诺值保持原样，变更须由用户在页面编辑保存。两份准备ready后只写sections指定章节并逐章校验，不扩展范围，不合册。',revise:'按tender-body技能修订页面所选章节，保留其他章节。',build:'按tender-body技能执行完整制作：用build_preparation读取当前规划状态，生成缺失的写作指引并校验，用build_preparation(stage=guide)记录；整理承诺清单并用build_preparation(stage=promises)记录。具体承诺值缺失时一次提问并停轮，页面作答后在同一会话继续。两份规划就绪后补写尚无正文的章节，并完成build_preparation中标为draft的未完成章节（先核对当前文件，不盲目覆盖）；不覆盖已有章节，不因当前选中章节缩小整本范围。逐节校验、全局检查，全部所需章节存在后合册。已存在但依据变化的正文保留并点名待核对，不擅自改写。'};
async function jsonFile(p){try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function atomic(p,data){await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p+'.tmp',JSON.stringify(data));await rename(p+'.tmp',p)}
function eventsView(events,questions,live){
 const end=events.findLast(e=>e.type==='turn/end');const reason=end?.data.reason;
 const pending=(questions.active??[]).filter(q=>q.state==='continued');
 const state=live?.status==='running'?'running':pending.length?'needs_input':reason?.kind==='error'?'failed':reason?.kind==='aborted'?'stopped':reason?.kind==='completed'?'completed':'failed';
 return {state,error:reason?.kind==='error'?reason.error?.message:state==='failed'?'执行中断，成果已保留，请读取成果后重新发起所需阶段。':undefined,questions:pending};
}
export class BusinessRuntime{
 constructor(ctx){this.ctx=ctx;this.settling=new Map();this.handles=new Map();this.admissions=new Set();this.pendingHandles=new Map();this.knowledge=new Map();this.closed=false}
 assertOpen(){if(this.closed)throw new BusinessError(503,'ooo-bidpliot 正在关闭，请重新启用后继续')}
 admit(tid,message){this.assertOpen();if(this.admissions.has(tid))throw new BusinessError(409,message);this.admissions.add(tid)}
 release(tid){this.admissions.delete(tid);if(!this.admissions.size)this.admissionDrain?.resolve()}
 async init(){
  await mkdir(actions,{recursive:true});await mkdir(locks,{recursive:true});
  for(const name of await readdir(locks)){const pid=Number(await readFile(join(locks,name),'utf8'));try{process.kill(pid,0)}catch{await unlink(join(locks,name))}}
  await mkdir(knowledgeJobs,{recursive:true});
  for(const name of await readdir(knowledgeJobs)){
   const path=join(knowledgeJobs,name),job=await jsonFile(path);
   try{process.kill(job.pid,0)}catch(e){if(e.code!=='ESRCH')throw e;await business(this.ctx,'kb_recover',{id:job.id});await unlink(path)}
  }
  const persona='你是页面驱动的招投标执行Agent，业务方法严格遵循所加载灵燕技能。页面已经选择主文件、补充文件、动作和章节；不重复请求授权，不设结果确认门，不要求用户在聊天回复继续。技能中的具体缺值使用ask_user_question，返回pending后本轮停轮，等待页面具体答复。阶段完成只说明已产出的文档，不把turn结束当作整册验收通过，制作步骤不审核生成内容质量，审查步骤按招标依据核查投标文件。使用read/write/edit/glob/grep及原Python业务工具；task委派原目录/正文角色。所有业务成果位于当前任务work，来源位于sources；技能参考文件在skills。默认完整文件访问权限，任务路径只是业务落盘约定。';
  await this.ctx.agentPresets.register({id:'ooo-bidpliot-execution',name:'ooo-bidpliot 业务执行',plugins:[
   {name:'@deepseek-ai/dsh-persona',config:{prefix:persona,includeRuntimeContext:true}},
   {name:'@deepseek-ai/dsh-tool-fs',inject:['tools','fs','systemPrompt','attachments','llm'],config:{}},{name:'@deepseek-ai/dsh-tool-fs-search',config:{sampleOverCapGlobResults:false}},
   {name:'@deepseek-ai/dsh-tool-skill',config:{}},{name:'@deepseek-ai/dsh-tool-ask-user',config:{mode:'timed',timeout:1}},
   {name:'ooo-bidpliot/tools',config:{}},
  ]});
  await this.ctx.plugin((await import('@deepseek-ai/dsh-skill-filesystem')),{includeDefaultRoots:false,customSkillDirs:[join(root,'business/python/app/skills')],watch:false});
  this.guardOff=installExecutionGuard(this.ctx,(tid,sessionId,message)=>this.preparationProblem(tid,sessionId,message));

 }
 async skillsLink(cwd){await mkdir(cwd,{recursive:true});try{await symlink(join(root,'business/python/app/skills'),join(cwd,'skills'),'dir')}catch(e){if(e.code!=='EEXIST')throw e}}
 async select(){const selection=this.ctx.agentDefaultModel.currentSelection();if(!selection.provider||!selection.model)throw new BusinessError(422,'请先在dsh选择已配置的模型');return selection}
 async handle(record){
  if(this.handles.has(record.session_id))return this.handles.get(record.session_id);
  if(!this.pendingHandles.has(record.session_id))this.assertOpen();
  const setup=async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot-execution')};
  if(!this.pendingHandles.has(record.session_id))this.pendingHandles.set(record.session_id,this.ctx.agents.resume({resumeSessionId:record.session_id,agentOptions:record.model,setup}).then(handle=>{this.handles.set(record.session_id,handle);return handle}).finally(()=>this.pendingHandles.delete(record.session_id)));return this.pendingHandles.get(record.session_id);
 }
 async projection(record){
  const handle=await this.handle(record),agent=handle.agent;const snapshot=this.ctx.sessionProjections.snapshot(agent.session,['userQuestions']);const questions=snapshot.values.userQuestions??{active:[],settled:[]};
  const view={session_id:record.session_id,kind:record.kind,model:record.model,sections:record.sections??[],...eventsView(agent.session.snapshotEvents(),questions,agent)};
  if(record.stopped_at){view.state='stopped';view.questions=[];delete view.error}
  if(record.preparation_error&&!record.stopped_at&&view.state!=='running'){view.state='failed';view.questions=[];view.error=record.preparation_error}
  if(record.kind==='review'&&record.finished_state==='failed'){view.state='failed';view.error=record.review_error}
  if(view.state==='completed'&&record.kind==='review'&&(await business(this.ctx,'state',{task_id:record.task_id})).review.report?.session_id!==record.session_id){view.state='failed';view.error=record.review_error??'本轮未生成有效审查报告'}
  if(view.state==='completed'){
   const state=await business(this.ctx,'state',{task_id:record.task_id});const names=new Set(state.files.map(f=>f.path));
   const missing=record.kind==='analyse'?requiredAnalysis.map(n=>'analysis/'+n).filter(n=>!names.has(n)):record.kind==='outline'?!state.directory?['投标目录']:[]:record.kind==='guide'?!names.has('body/写作指引.md')?['写作指引']:[]:record.kind==='promises'?!names.has('body/关键事实与承诺.md')?['关键事实与承诺']:[]:['build','body','revise'].includes(record.kind)?(record.sections?.length?record.sections.filter(s=>{const item=state.body_sections.find(b=>b.volume===s.volume&&b.title===s.title);return !item||!state.body_files.includes(item.path)||item.status!=='ready'}).map(s=>s.title):state.body_sections.filter(s=>!state.body_files.includes(s.path)||s.status==='draft').map(s=>s.title)):[];
   if(['body','revise','guide','promises'].includes(record.kind)){
    const stages=record.kind==='guide'?['guide']:['guide','promises'];
    for(const kind of stages)if(state.build_preparation[kind]!=='ready')missing.push(kind==='guide'?'写作指引未就绪':'关键事实与承诺未就绪');
   }
   if(record.kind==='build'){
    for(const kind of ['guide','promises'])if(state.build_preparation[kind]!=='ready')missing.push(kind==='guide'?'写作指引未完成':'承诺清单未完成');
    if(!state.volume_states.length)missing.push('整册标书');
    else missing.push(...state.volume_states.filter(v=>v.status!=='ready').map(v=>v.name+'整册未完成生成或发布'));
   }
   if(missing.length){view.state='failed';view.error=record.preparation_error??'本轮未产出所需文件：'+missing.join('、')+'。已有成果保留，请重新发起该阶段。'}
  }
  return view;
 }
 async tasks(){const result=await business(this.ctx,'tasks');for(const task of result.tasks)if(task.review_status==='running'){const record=(await this.latestRecord(task.id,'review'))?.record;if(record)await this.recoverReview(record)}return business(this.ctx,'tasks')}
 async artifacts(tid){return business(this.ctx,'route',{method:'GET',path:'/artifacts',query:{task_id:tid}})}
 async latestRecord(tid,kind){
  const dir=join(actions,tid);let names;try{names=await readdir(dir)}catch(e){if(e.code==='ENOENT')return null;throw e}
  const records=[];for(const name of names.filter(n=>n.endsWith('.json')&&n!=='latest.json')){const path=join(dir,name),record=await jsonFile(path);if(record.kind===kind)records.push({record,path})}return records.sort((a,b)=>b.record.created_at-a.record.created_at)[0]??null;
 }
 async state(tid){let record=await jsonFile(join(actions,tid,'latest.json'));if(record&&(await this.handle(record)).agent.status!=='running'){await this.settling.get(tid);record=await jsonFile(join(actions,tid,'latest.json'))}if(record?.kind==='review')await this.recoverReview(record);record=await jsonFile(join(actions,tid,'latest.json'));const execution=record?await this.projection(record):null;const base=await business(this.ctx,'state',{task_id:tid});const analysis=(await this.latestRecord(tid,'analyse'))?.record;return {...base,analysis_progress:analysis?.analysis_progress??analysisProgress(base.files,analysis?.analysis_before,analysis?.created_at),execution}}
 async assertIdle(tid){if(this.admissions.has(tid))throw new BusinessError(409,'当前项目正在提交');return this.idleState(tid)}
 async idleState(tid){const state=await this.state(tid);if(['running','needs_input'].includes(state.execution?.state))throw new BusinessError(409,'当前项目正在执行，请先停止或填写具体选项');await this.settling.get(tid);await this.freezeAnalysis(tid);return state}
 async saveSources(tid,payload){
  this.admit(tid,'当前项目正在提交');
  try{
   const state=await this.idleState(tid);
   if(payload.input_version!==state.input_versions.analyse)throw new BusinessError(409,'来源选择已变化，请刷新页面后继续');
   await business(this.ctx,'sources',{task_id:tid,main_file:payload.main_file,supplements:payload.supplements});
   return await this.state(tid);
  }finally{this.release(tid)}
 }
 async saveReviewInput(tid,payload){this.admit(tid,'当前项目正在提交');try{const state=await this.idleState(tid);if(payload.input_version!==state.input_versions.review)throw new BusinessError(409,'审查文件已变化');await business(this.ctx,'review_input',{task_id:tid,bids:payload.bids});return await this.state(tid)}finally{this.release(tid)}}
 async reviewDecision(tid,payload){this.admit(tid,'当前项目正在提交');try{await this.idleState(tid);return await business(this.ctx,'review_decide',{task_id:tid,...payload})}finally{this.release(tid)}}
 async saveBidder(tid,payload){
  this.admit(tid,'当前项目正在提交');
  try{await this.idleState(tid);return await business(this.ctx,'route',{method:'PUT',path:'/projects/'+tid+'/bidder',body:payload})}
  finally{this.release(tid)}
 }
 async requireCurrent(tid,kind,state){
  const record=(await this.latestRecord(tid,kind))?.record;
  if((['guide','promises'].includes(kind)&&state.build_preparation[kind]!=='ready')||(!['guide','promises'].includes(kind)&&(!record||record.input_version!==state.input_versions[kind]||(await this.projection(record)).state!=='completed')))throw new BusinessError(409,{analyse:'解读依据已变化，请重新解读',outline:'目录依据已变化，请重新生成目录',guide:'写作指引依据已变化，请重新生成写作指引',promises:'承诺清单依据已变化，请重新生成关键事实与承诺'}[kind]);
 }
 async action(tid,payload){
  this.admit(tid,'操作正在提交，请读取最新状态');
  try{
   if(!instructions[payload.kind]||typeof payload.request_id!=='string'||payload.request_id.length<8)throw new BusinessError(422,'操作参数无效');
   const dir=join(actions,tid);await mkdir(dir,{recursive:true});const key=createHash('sha256').update(payload.request_id).digest('hex');const path=join(dir,key+'.json');const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');const old=await jsonFile(path);
   if(old){if(old.payload_hash!==hash)throw new BusinessError(409,'同一请求的操作内容已变化');return {session_id:old.session_id,replayed:true}}
   await this.settling.get(tid);const state=await this.state(tid);if(['running','needs_input'].includes(state.execution?.state))throw new BusinessError(409,'当前执行尚未结束');
   await this.freezeAnalysis(tid);
   if(payload.input_version!==state.input_versions[payload.kind])throw new BusinessError(409,'操作依据已变化，请刷新页面后继续');
   let bidderSnapshot;
   if(['guide','promises','body','revise','build'].includes(payload.kind))bidderSnapshot=await business(this.ctx,'bidder_snapshot',{task_id:tid});
   if(payload.kind==='review'){const selection=state.source_selection;if(!selection.main)throw new BusinessError(422,'请选择招标文件');if(state.review.mode==='external'&&!state.review.bids.length||state.review.mode==='platform'&&!state.body_sections.some(s=>state.body_files.includes(s.path)))throw new BusinessError(422,'尚无待审核投标文件或正文')}
   const files=new Set(state.files.map(f=>f.path));
   if(payload.kind==='outline'&&!requiredAnalysis.every(n=>files.has('analysis/'+n)))throw new BusinessError(409,'八份招标解读尚未全部生成');
   if(['guide','promises','body','revise','build'].includes(payload.kind)&&!state.directory)throw new BusinessError(409,'尚未生成投标目录');
   if(['promises','revise'].includes(payload.kind)&&!files.has('body/写作指引.md'))throw new BusinessError(409,'尚未生成写作指引');
   if(payload.kind==='revise'&&!files.has('body/关键事实与承诺.md'))throw new BusinessError(409,'尚未生成关键事实与承诺');
   if(['body','build'].includes(payload.kind)){
    const stale=Object.entries(state.build_preparation).filter(([,status])=>status==='stale').map(([stage])=>stage==='guide'?'写作指引':'关键事实与承诺');
    if(stale.length)throw new BusinessError(409,stale.join('、')+'的依据已变化，请在对应页签核对、编辑并保存后继续；已有正文保留');
   }
   const dependencies={outline:'analyse',guide:'outline',promises:'guide',body:'outline',revise:'promises',build:'outline'};if(dependencies[payload.kind])await this.requireCurrent(tid,dependencies[payload.kind],state);
   if(payload.kind==='outline'){if(!Object.hasOwn(payload,'page_target'))throw new BusinessError(422,'请选择目标篇幅或不限篇幅');await business(this.ctx,'outline_options',{task_id:tid,page_target:payload.page_target,numbering:payload.numbering})}
   const sections=payload.sections??[];
   if(sections.length&&(!['body','revise'].includes(payload.kind)||sections.some(s=>!state.body_sections.some(b=>b.volume===s.volume&&b.title===s.title))||new Set(sections.map(s=>JSON.stringify(s))).size!==sections.length))throw new BusinessError(422,'所选章节不属于当前目录');
   if(payload.kind==='body'&&!sections.length)throw new BusinessError(422,'请选择需要生成的章节');
   if(payload.kind==='revise'&&(!sections.length||!payload.instruction?.trim()))throw new BusinessError(422,'请选择修改章节并填写修改要求');
   if(payload.kind==='analyse'){
    await business(this.ctx,'sources',{task_id:tid,main_file:payload.main_file,supplements:payload.supplements??[]});
   }
   const model=await this.select();const sessionId='bid-'+randomUUID();const cwd=join(dataRoot,'workspace',tid);await this.skillsLink(cwd);
   await writeFile(join(locks,tid),String(process.pid),{flag:'wx'});
   let handle;const previous=await jsonFile(join(dir,'latest.json'));
   try{
    handle=await this.ctx.agents.create({sessionId,meta:{cwd,agentPreset:'ooo-bidpliot-execution'},agentOptions:model,setup:async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot-execution')}});
    this.handles.set(sessionId,handle);
    const section_paths=state.body_sections.filter(s=>payload.kind==='build'?(s.status==='missing'||s.status==='draft'):sections.some(p=>p.volume===s.volume&&p.title===s.title)).map(s=>s.path);
    const record={session_id:sessionId,task_id:tid,kind:payload.kind,model,payload_hash:hash,input_version:(await business(this.ctx,'state',{task_id:tid})).input_versions[payload.kind],created_at:Date.now(),sections,section_paths,...(payload.kind==='analyse'?{analysis_before:Object.fromEntries(state.files.map(f=>[f.path,f.hash]))}:{})};
    await atomic(path,record);await atomic(join(dir,'latest.json'),record);
    const prompt=instructions[payload.kind]+'\n页面输入：'+JSON.stringify(payload)+'\n制作状态：'+JSON.stringify(state.build_preparation)+'；目录篇幅：'+JSON.stringify(state.directory?.content.page_target??null)+(bidderSnapshot?'\n已确认投标主体信息（唯一身份依据）：'+JSON.stringify(bidderSnapshot)+'。先读取此快照，已有公司地址、电话、传真、邮箱、签字代表姓名和职务及签署日期直接使用，不再次提问。缺失或项目专属承诺才提问。所有公司资质与业绩只检索本主体；写作素材全库共用，注入后修订并检查旧项目和旧主体名称。':'')+'\n当前任务绝对路径：'+cwd+'；来源集合以work/parse/sources.json为准。';
    handle.agent.followup(createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'human'}}));
    this.track(handle,tid);return {session_id:sessionId,replayed:false};
   }catch(e){await unlink(join(locks,tid)).catch(()=>{});await unlink(path).catch(()=>{});if(previous)await atomic(join(dir,'latest.json'),previous);else await unlink(join(dir,'latest.json')).catch(()=>{});if(handle){this.handles.delete(sessionId);await handle.dispose()}throw e}
  }finally{this.release(tid)}
 }
 async freezeAnalysis(tid,sessionId){const entry=await this.latestRecord(tid,'analyse');if(!entry||(sessionId&&entry.record.session_id!==sessionId)||entry.record.analysis_progress)return;const view=await this.projection(entry.record);if(['running','needs_input'].includes(view.state))return;const state=await business(this.ctx,'state',{task_id:tid});entry.record.analysis_progress=analysisProgress(state.files,entry.record.analysis_before,entry.record.created_at);await atomic(entry.path,entry.record)}
 async preparationProblem(tid,sessionId,message){for(const name of (await readdir(join(actions,tid))).filter(n=>n.endsWith('.json'))){const path=join(actions,tid,name),stored=await jsonFile(path);if(stored.session_id===sessionId)await atomic(path,{...stored,preparation_error:message})}}
 async writeReviewState(record,finished_state,review_error){const dir=join(actions,record.task_id);for(const name of (await readdir(dir)).filter(n=>n.endsWith('.json'))){const path=join(dir,name),stored=await jsonFile(path);if(stored.session_id===record.session_id)await atomic(path,{...stored,finished_state,review_error})}}
 async finishReview(record,handle){let finished=eventsView(handle.agent.session.snapshotEvents(),this.ctx.sessionProjections.snapshot(handle.agent.session,['userQuestions']).values.userQuestions??{},handle.agent).state;let review_error;if(finished==='completed'&&!record.stopped_at){try{await business(this.ctx,'review_finish',{task_id:record.task_id,session_id:record.session_id})}catch(error){finished='failed';review_error=error.message}}await this.writeReviewState(record,finished,review_error)}
 async recoverReview(record){if(record.finished_state||this.settling.has(record.task_id))return;const handle=await this.handle(record);if(handle.agent.status!=='running')await this.finishReview(record,handle)}
 track(handle,tid){const done=handle.agent.whenIdle().then(async()=>{await this.ctx.sessions.flush(handle.agent.session);const record=await jsonFile(join(actions,tid,'latest.json'));if(record?.kind==='review')await this.finishReview(record,handle);if(record?.kind==='analyse')await this.freezeAnalysis(tid,record.session_id);if(['guide','promises'].includes(record?.kind)&&eventsView(handle.agent.session.snapshotEvents(),this.ctx.sessionProjections.snapshot(handle.agent.session,['userQuestions']).values.userQuestions??{},handle.agent).state==='completed'){try{await business(this.ctx,'record_preparation',{task_id:tid,stage:record.kind,session_id:record.session_id})}catch(error){await this.preparationProblem(tid,record.session_id,error.message)}}}).catch(e=>{console.error('ooo-bidpliot execution persistence:',e.message)}).finally(async()=>{await unlink(join(locks,tid)).catch(()=>{});if(this.settling.get(tid)===done)this.settling.delete(tid)});this.settling.set(tid,done)}
 async stop(tid,sessionId){const dir=join(actions,tid),record=await jsonFile(join(dir,'latest.json'));if(record?.session_id!==sessionId)throw new BusinessError(409,'当前执行已变化');const handle=await this.handle(record);record.stopped_at=Date.now();for(const name of (await readdir(dir)).filter(n=>n.endsWith('.json'))){const path=join(dir,name),stored=await jsonFile(path);if(stored.session_id===sessionId)await atomic(path,{...stored,stopped_at:record.stopped_at})}handle.agent.cancel({kind:'user'});await handle.agent.whenIdle();await this.ctx.sessions.flush(handle.agent.session);await this.settling.get(tid);await this.freezeAnalysis(tid,sessionId);await unlink(join(locks,tid)).catch(()=>{});return {ok:true}}
 async answer(tid,sessionId,body){const record=await jsonFile(join(actions,tid,'latest.json'));if(record?.session_id!==sessionId)throw new BusinessError(409,'当前问题已变化');const handle=await this.handle(record);const view=await this.projection(record);const current=view.questions.map(q=>q.callId);if(view.state!=='needs_input'||JSON.stringify(current)!==JSON.stringify(body.call_ids))throw new BusinessError(409,'本次问题已变化，请读取最新问题');
  if(!Array.isArray(body.batches)||body.batches.length!==view.questions.length)throw new BusinessError(422,'请填写全部具体选项');
  const batches=view.questions.map(q=>{const matches=body.batches.filter(b=>b.call_id===q.callId);const answers=matches[0]?.answers;if(matches.length!==1||!Array.isArray(answers)||answers.length!==q.questions.length||new Set(answers.map(a=>a.id)).size!==answers.length||q.questions.some(item=>!answers.some(a=>a.id===item.id)))throw new BusinessError(422,'问题与回答不一致');for(const item of q.questions){const a=answers.find(a=>a.id===item.id);if(!Array.isArray(a.selected)||a.selected.some(v=>typeof v!=='string'||!item.options?.some(o=>o.label===v))||new Set(a.selected).size!==a.selected.length||(!item.multiSelect&&a.selected.length>1)||(a.custom!==undefined&&typeof a.custom!=='string')||(!a.selected.length&&!a.custom?.trim()))throw new BusinessError(422,'请填写有效的选择或说明')}return {callId:q.callId,answers}});
  await this.settling.get(tid);await writeFile(join(locks,tid),String(process.pid),{flag:'wx'});
  try{if(record.kind==='review')await this.writeReviewState(record,undefined);for(const batch of batches){if(!this.ctx.userQuestions.answer(handle.agent,batch.callId,{answers:batch.answers}))throw new BusinessError(409,'问题已结束')}this.track(handle,tid);return {ok:true}}catch(e){await unlink(join(locks,tid)).catch(()=>{});throw e}
 }

 ingestKnowledge(id){
  this.assertOpen();
  if(this.knowledge.has(id))return this.knowledge.get(id).done;
  const controller=new AbortController(),job={controller};this.knowledge.set(id,job);
  job.done=(async()=>{
   const path=join(knowledgeJobs,id+'.json');await writeFile(path,JSON.stringify({id,pid:process.pid}),{flag:'wx'});
   try{await this.runKnowledge(id,controller.signal)}finally{await unlink(path)}
  })().finally(()=>this.knowledge.delete(id));return job.done;
 }
 async runKnowledge(id,signal){
  let handle;
  try{
   const cwd=join(dataRoot,'workspace','knowledge');await this.skillsLink(cwd);
   handle=await this.ctx.agents.create({sessionId:'kb-'+randomUUID(),meta:{cwd,agentPreset:'ooo-bidpliot-execution'},agentOptions:await this.select(),setup:async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot-execution')}});
   const prepared=await business(this.ctx,'kb_prepare',{id},{signal});await transcribe(this.ctx,prepared,{agent:handle.agent,signal});
   const p=await business(this.ctx,'kb_prompt',{id},{signal});const run=await this.ctx.subagents.start('spawn',{parent:handle.agent,signal,persona:p.system,toolFilter:{allow:[]},prompt:[{type:'text',text:p.prompt}]});
   try{const result=await run.result;if(result.stopReason!=='completed')throw subagentFailure(run,result,'资料整理未完成');const text=result.output.filter(b=>b.type==='text').map(b=>b.text).join('');await business(this.ctx,'kb_finish',{id,metadata:jsonResponse(text)},{signal})}finally{await run.dispose()}
  }catch(e){await business(this.ctx,'kb_fail',{id,error:signal.aborted?'资料处理已中断，请重新解析':e.message})}finally{await handle?.dispose()}
 }
 close(){
  if(this.closing)return this.closing;
  this.closed=true;
  return this.closing=(async()=>{
   if(this.admissions.size){this.admissionDrain=Promise.withResolvers();await this.admissionDrain.promise}
   for(const job of this.knowledge.values())job.controller.abort();
   await Promise.allSettled([...this.knowledge.values()].map(job=>job.done));
   await Promise.allSettled([...this.pendingHandles.values()]);
   const handles=[...this.handles.values()];
   for(const handle of handles)if(handle.agent.status==='running')handle.agent.cancel({kind:'user'});
   await Promise.allSettled(handles.map(handle=>handle.agent.whenIdle()));
   await Promise.allSettled([...this.settling.values()]);
   const results=await Promise.allSettled(handles.map(async handle=>{
    try{await this.ctx.sessions.flush(handle.agent.session)}finally{await handle.dispose()}
   }));
   this.handles.clear();this.guardOff?.();
   const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
   if(failures.length)throw new AggregateError(failures,'ooo-bidpliot 会话关闭失败');
  })();
 }
}
