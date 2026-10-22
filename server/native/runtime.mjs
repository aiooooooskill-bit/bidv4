import {mkdir,readFile,writeFile,rename,unlink,readdir,symlink,readlink,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {business,dataRoot,root,BusinessError,taskPathContext} from './business.mjs';
import {transcribe,subagentFailure,startSubtask} from './tools.mjs';
import {analysisProgress} from '../../shared/analysis-progress.js';
import {actionSatisfied,manualDirectoryCurrent} from '../../shared/delivery-status.js';
import {installExecutionGuard} from './execution-guard.mjs';
import {jsonResponse} from './markdown.mjs';
import {Workflows} from './workflow.mjs';
import {chatToolNames} from '../agent.mjs';
import {presetDefinition,subtaskProviderNames,writingReadTools} from './preset.mjs';
import {apply as applySpawnProvider} from '@deepseek-ai/dsh-subagent-spawn-in-process';
import {conversationTasks,taskForAgent} from './conversations.mjs';
const actions=join(dataRoot,'actions'),locks=join(dataRoot,'locks'),knowledgeJobs=join(dataRoot,'knowledge-jobs');
const requiredAnalysis=['structure.md','requirements-submission.md','requirements-business.md','requirements-qualification.md','evaluation.md','requirements-format.md','disqualification.md','clarifications.md'];
const readOnlyInstruction='本轮为明确只读任务。按原始要求派发所选现稿的读取、核验及逐节validate_body；主线程和写手均不修改任何正文、共享准备或目录。不因现有规划、主体快照或待办默认转为业务实质审查或追加取证；原始要求未点名的业务问题仅记录。回收所有任务后按工具真实结果汇报并结束，不重启阶段、不合册。';
const instructions={review:'保存时逐项提供完整招标引用、实际投标事实bid_facts及applicability，程序保留原文限定qualifications；新证据通过本轮evidence_index_path回查，review_batch(batch_id)回读并更正受影响的早期批次，不读取其他轮判断。条件成立与适用范围未明确时必须uncertain且仅列需确认。按tender-review技能复用文档解析、七类要点和共享证据规则，结合review_basis返回的前序有效成果。比较前先区分条款的参数量纲、完成窗口、排期与最低投入量：时间窗口不能换算为最低授课或工作时长，数量不足必须有原文明示的最低数量依据。合同、报价总费用、后文方案和附件对同一义务的回应要合并取证；专项章节未重复条件不等于全文缺失，笼统承诺也不能掩盖具体相反承诺。存在有条件条款或适用范围歧义时先并列完整依据，适用性尚未明确的列为需确认，不自行判定优先级或直接判冲突。金额、人数、期限等数字须逐字回查当前引用，禁止凭模板或记忆填写。更正一个结论时，在本轮内同步核对引用相同义务的其他类别、废标后果与评分项，避免残留相反结论；图片证明无法核验时不得确定承诺得分。已有八份有效要点时直接validate复用。首次或恢复时调用review_batch取当前批次，最多8项；save_review_batch成功回执的next已包含下一批完整要求，直接使用，不再调用review_batch重复读取。需要更正时才传已保存batch_id回读。每个slot的判断、tender/bid引用和problems写在同一对象内，tender保留原要点依据并收录回读到的相关完整条款、限定或冲突区段，不自选requirement_id，不手写行号。仅有本轮一次审核；save_review_batch执行条目、关联、原文范围和版本的程序校验后保存，不再调用其他模型复审。程序错误按提示修复，禁止删项或无依据改uncertain。继续所有批次直至complete，再finish_review_report汇总。不要读取此前失败的对照草稿，不重复传整份清单。后文新证据导致先前判断变化时，同一个Agent在本轮结束前更正该已保存批次，不额外复审。原解读和投标正文不修改。',analyse:'按document-parse和tender-analysis技能解析页面指定的全部来源，完成八份解读文件。结束后停轮。',outline:'按tender-outline技能生成并发布单册或多册目录，结束后停轮。',guide:'按tender-body技能仅生成body/写作指引.md，结束后停轮。',promises:'按tender-body技能仅生成body/关键事实与承诺.md，未提供的具体承诺值向页面提问，结束后停轮。',body:'按tender-body技能生成页面所选章节。先读取build_preparation，复用ready规划，只补齐缺失准备；生成指引后校验并记录guide，整理承诺后记录promises。具体缺值集中ask_user_question，页面答复后同会话继续。已有承诺值保持原样，变更须由用户在页面编辑保存。两份准备ready后只写sections指定章节并逐章校验，不扩展范围，不合册。',revise:'按tender-body技能仅处理页面instruction明确要求的所选现稿片段。先读取真实原稿及定位，定向修改后逐节validate_body；不执行生成步骤，不因规划、缺口或已有主体快照而自行补写、插图或加批注；未被点名内容及其他章节全部保留。',build:'按tender-body技能执行完整制作：用build_preparation读取当前规划状态，生成缺失的写作指引并校验，用build_preparation(stage=guide)记录；整理承诺清单并用build_preparation(stage=promises)记录。具体承诺值缺失时一次提问并停轮，页面作答后在同一会话继续。两份规划就绪后补写尚无正文的章节，并完成build_preparation中标为draft的未完成章节（先核对当前文件，不盲目覆盖）；不覆盖已有章节，不因当前选中章节缩小整本范围。逐节校验、全局检查，全部所需章节存在后合册。已存在但依据变化的正文保留并点名待核对，不擅自改写。'};
async function jsonFile(p){try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function atomic(p,data){await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p+'.tmp',JSON.stringify(data));await rename(p+'.tmp',p)}
function eventsView(events,questions,live){
 const end=events.findLast(e=>e.type==='turn/end');const reason=end?.data.reason;
 const pending=(questions.active??[]).filter(q=>q.state==='continued');
 const state=live?.status==='running'?'running':pending.length?'needs_input':reason?.kind==='error'?'failed':reason?.kind==='aborted'?'stopped':reason?.kind==='completed'?'completed':'failed';
 return {state,error:reason?.kind==='error'?reason.error?.message:state==='failed'?'执行中断，成果已保留，请读取成果后重新发起所需阶段。':undefined,questions:pending};
}
export class BusinessRuntime{
 constructor(ctx){this.ctx=ctx;this.settling=new Map();this.executionOwners=new Map();this.handles=new Map();this.admissions=new Set();this.pendingHandles=new Map();this.knowledge=new Map();this.closed=false;this.presetDisposers=[];this.stageTools=new Map();this.workflows=new Workflows(this)}
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
  this.toolNames=(await business(this.ctx,'schemas')).map(s=>s.name);
  for(const providerName of subtaskProviderNames)applySpawnProvider(this.ctx,{providerName});
  this.presetDisposers.push(await this.ctx.agentPresets.register(presetDefinition));
  await mkdir(join(dataRoot,'conversations'),{recursive:true});
  for(const name of await readdir(join(dataRoot,'conversations'))){const value=await jsonFile(join(dataRoot,'conversations',name));conversationTasks.set(value.session_id,value.task_id)}
  this.continuationOff=this.ctx.on('agent/pre-step',async({agent,messages,signal},next)=>{
   const tid=taskForAgent(agent);
   if(tid){
    const owner=this.executionOwners.get(tid);
    if(owner?.agent===agent&&!owner.waitingForIdle)await this.settling.get(tid);
    const record=await jsonFile(join(actions,tid,'latest.json'));
    if(record?.session_id===agent.id){
     await this.applyStageTools(agent,record.kind,record.read_only);await this.enterStage(agent,record,signal);
     const previous=record.outcome??this.executionView(record,agent);
     if(previous.state==='needs_input'){
      const calls=new Set(previous.questions.map(q=>q.callId));
      const replies=new Set(messages.filter(m=>m.source.kind==='user-question-reply'&&calls.has(m.source.callId)).map(m=>m.source.callId));
      const questions=this.ctx.sessionProjections.snapshot(agent.session,['userQuestions']).values.userQuestions?.active??[];
      if(replies.size||!questions.some(q=>calls.has(q.callId)&&q.state==='continued')){
       await this.updateRecord(record,{outcome:null,end_seq:null,start_seq:agent.session.snapshotEvents().findLast(e=>e.type==='turn/start').seq});
       this.track(await this.handle(record),tid,record.action_id);
       const workflow=await this.workflows.snapshot(tid);
       if(workflow?.action_id===record.action_id&&['running','needs_input'].includes(workflow.state))this.workflows.resumeAfter(tid,agent);
      }
     }
    }
   }
   return next();
  },{global:true});
  this.requestOff=this.ctx.on('agent/request',async({agent},next)=>{const config=await next(),tid=taskForAgent(agent);if(!tid)return config;const record=await jsonFile(join(actions,tid,'latest.json'));if(record?.session_id!==agent.id||record.end_seq!=null||record.stopped_at)return config;const model=await this.select(record.kind,config);if(JSON.stringify(model)!==JSON.stringify(record.model))await this.updateRecord(record,{model});return record.kind==='review'?{...config,maxTokens:model.maxTokens}:config},{global:true});
  this.guardOff=installExecutionGuard(this.ctx,(tid,sessionId,message)=>this.preparationProblem(tid,sessionId,message));

 }
 async enterStage(agent,record,signal){
  if(record.history_before_seq==null||record.stage_context||record.end_seq!=null||record.stopped_at)return;
  const engine=this.ctx.agentPresets.serviceFor(agent,'compaction');
  const context=await engine.enterStage(agent,{beforeSeq:record.history_before_seq,directory:join(dataRoot,'workspace',record.task_id,'work/context',record.action_id),signal});
  await this.updateRecord(record,{stage_context:context});
 }
 async applyStageTools(agent,kind,readOnly=false){
  const mode=readOnly?'writing-readonly':kind==='review'?'review':kind==='outline'?'outline':'default',current=this.stageTools.get(agent.id);if(current?.mode===mode&&current.agent===agent)return current.ready;
  if(current?.fiber){await current.fiber.dispose();while(current.fiber.inertia)await current.fiber.inertia}
  const allow=mode==='writing-readonly'?['ooo_bidpliot_status','ooo_bidpliot_read','ooo_bidpliot_run','task',...writingReadTools]:mode==='review'?[...chatToolNames,'read','read_image','write','edit','glob','grep','skill','ask_user_question','prepare_review_documents','review_basis','review_batch','save_review_batch','finish_review_report']:mode==='outline'?[...chatToolNames,'read','read_image','write','edit','glob','grep','skill','ask_user_question','task','check_pipeline_state','outline_plan','check_outline','assemble_tender','read_artifact','update_task_progress']:null;
  const ready=Promise.withResolvers();
  const fiber=allow?agent.ctx.inject(['tools'],ctx=>{try{ctx.tools.restrict({allow});ready.resolve()}catch(error){ready.reject(error);throw error}}):null;
  if(!allow)ready.resolve();
  this.stageTools.set(agent.id,{agent,mode,fiber,ready:ready.promise});
  await ready.promise;
 }
 async skillsLink(cwd){
  await mkdir(cwd,{recursive:true});const path=join(cwd,'skills'),target=join(root,'business/python/app/skills');
  try{const info=await lstat(path);if(!info.isSymbolicLink())throw new BusinessError(409,'项目 skills 入口被实体目录占用，请先保留并检查');if(resolve(cwd,await readlink(path))===resolve(target))return;await unlink(path)}catch(e){if(e.code!=='ENOENT')throw e}
  await symlink(target,path,process.platform==='win32'?'junction':'dir');
 }
 modelSelection(agent){
  const pending=this.ctx.sessionProjections.stateOf(agent.session,'modelSelection')?.pending,header=agent.session.requestHeader();
  const selection=pending??header?.config??agent.options;
  return {...selection,...(!pending&&header?.adapterDefaults?.reasoningEffort?{reasoningEffort:undefined}:{})};
 }
 async select(kind,source=this.ctx.agentDefaultModel.currentSelection()){
  const selection={provider:source.provider,model:source.model,...(source.reasoningEffort===undefined?{}:{reasoningEffort:source.reasoningEffort})};
  if(!selection.provider||!selection.model)throw new BusinessError(422,'请先在dsh选择已配置的模型');
  if(kind==='review'){const info=await this.ctx.llm.resolveModelInfo(selection.provider,selection.model);if(!info.context?.contextWindow)throw new BusinessError(422,'所选模型未声明上下文容量，请在已有模型设置中补充');return {...selection,maxTokens:Math.min(info.defaultMaxTokens??32768,32768,Math.floor(info.context.contextWindow/4))}}
  return selection;
 }
 async handle(record){
  if(this.handles.has(record.session_id)&&this.ctx.agents.get(record.session_id)===this.handles.get(record.session_id).agent)return this.handles.get(record.session_id);this.handles.delete(record.session_id);
  const live=this.ctx.agents.get(record.session_id);if(live){const borrowed={agent:live,dispose:async()=>{}};this.handles.set(record.session_id,borrowed);return borrowed}
  if(!this.pendingHandles.has(record.session_id))this.assertOpen();
  const setup=async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot')};
  if(!this.pendingHandles.has(record.session_id))this.pendingHandles.set(record.session_id,this.ctx.agents.resume({resumeSessionId:record.session_id,agentOptions:record.model,setup}).then(handle=>{this.handles.set(record.session_id,handle);return handle}).finally(()=>this.pendingHandles.delete(record.session_id)));return this.pendingHandles.get(record.session_id);
 }
 async bindConversation(tid,agent){
  const path=join(dataRoot,'conversations',tid+'.json'),bound=await jsonFile(path);
  if(bound&&bound.session_id!==agent.id)throw new BusinessError(409,'项目已关联其他会话，请打开项目原会话继续');
  const existing=taskForAgent(agent);if(existing&&existing!==tid)throw new BusinessError(409,'本会话已关联项目，请在新会话创建其他项目');
  if(!bound){await mkdir(join(dataRoot,'conversations'),{recursive:true});try{await writeFile(path,JSON.stringify({task_id:tid,session_id:agent.id}),{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;const actual=await jsonFile(path);if(actual.session_id!==agent.id)throw new BusinessError(409,'项目已关联其他会话，请打开项目原会话继续')}}conversationTasks.set(agent.id,tid);
  this.ctx.get('permissionPresets')?.set(agent.session,'danger-full-access');
 }
 async conversation(tid,model,agent){
  if(agent){await this.bindConversation(tid,agent);return this.handle({session_id:agent.id,model})}
  const bound=await jsonFile(join(dataRoot,'conversations',tid+'.json'));if(bound)return this.handle({...bound,model});
  model=await this.select(undefined,model);
  const sessionId='bid-'+randomUUID(),cwd=join(dataRoot,'workspace',tid);await this.skillsLink(cwd);
  const handle=await this.ctx.agents.create({sessionId,meta:{cwd,agentPreset:'ooo-bidpliot'},agentOptions:model,setup:async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot')}});
  this.handles.set(sessionId,handle);await this.bindConversation(tid,handle.agent);return handle;
 }
 async updateRecord(record,patch){
  const dir=join(actions,record.task_id);for(const name of (await readdir(dir)).filter(n=>n.endsWith('.json'))){const path=join(dir,name),stored=await jsonFile(path);if(stored.action_id===record.action_id)await atomic(path,{...stored,...patch})}
 }
 executionView(record,agent){
  const owner=this.executionOwners.get(record.task_id),owned=owner?.actionId===record.action_id&&owner.agent===agent;
  const tail=agent.session.snapshotEvents().filter(e=>e.seq>=record.start_seq);
  // An unowned unfinished record cannot claim later turns in the same conversation.
  const endSeq=record.end_seq??(owned?owner.endSeq:tail.find(e=>e.type==='turn/end')?.seq);
  const events=tail.filter(e=>endSeq==null||e.seq<=endSeq);
  const calls=new Set(events.filter(e=>e.type==='tool/call').map(e=>e.data.callId));
  const questions=owned&&!owner.waitingForIdle?owner.questions:this.ctx.sessionProjections.snapshot(agent.session,['userQuestions']).values.userQuestions??{};
  const active=(questions.active??[]).filter(q=>calls.has(q.callId));
  if(record.end_seq==null&&!owned)return {state:active.some(q=>q.state==='continued')?'needs_input':'failed',error:active.some(q=>q.state==='continued')?undefined:'执行中断，成果已保留，请读取成果后重新发起所需阶段。',questions:active.filter(q=>q.state==='continued')};
  return eventsView(events,{...questions,active},record.end_seq==null&&owned&&owner.waitingForIdle?agent:undefined);
 }
 async projection(record,state){
  state??=await business(this.ctx,'state',{task_id:record.task_id});
  const handle=await this.handle(record),agent=handle.agent;
  const view={session_id:record.session_id,action_id:record.action_id,created_at:record.created_at,kind:record.kind,read_only:record.read_only===true,model:record.model,sections:record.sections??[],...(record.outcome??this.executionView(record,agent))};
  if(record.stopped_at){view.state='stopped';view.questions=[];delete view.error}
  if(record.preparation_error&&!record.stopped_at&&view.state!=='running'){view.state='failed';view.questions=[];view.error=record.preparation_error}
  if(record.kind==='review'&&record.finished_state==='failed'){view.state='failed';if(record.review_error)view.error=record.review_error}
  if(view.state==='completed'&&record.kind==='review'&&state.review.report?.session_id!==record.session_id){view.state='failed';view.error=record.review_error??'本轮未生成有效审查报告'}
  const savedAfterCompletion=record.verified_completed_at&&['outline','guide','promises','body','revise','build'].includes(record.kind)&&manualDirectoryCurrent(state,{created_at:record.verified_completed_at});
  let validationMissing=false;
  if(view.state==='completed'&&!savedAfterCompletion){
   const names=new Set(state.files.map(f=>f.path));
   const missing=record.kind==='analyse'?requiredAnalysis.map(n=>'analysis/'+n).filter(n=>!names.has(n)):record.kind==='outline'?!state.directory?['投标目录']:[]:record.kind==='guide'?!names.has('body/写作指引.md')?['写作指引']:[]:record.kind==='promises'?!names.has('body/关键事实与承诺.md')?['关键事实与承诺']:[]:['build','body','revise'].includes(record.kind)?(record.sections?.length?record.sections.filter(s=>{const item=state.body_sections.find(b=>b.volume===s.volume&&b.title===s.title);return !item||!state.body_files.includes(item.path)||item.status!=='ready'}).map(s=>s.title):state.body_sections.filter(s=>!state.body_files.includes(s.path)||s.status!=='ready').map(s=>s.title)):[];
   if(['build','body','revise'].includes(record.kind)){
    const selected=record.section_paths?.length?state.body_sections.filter(s=>record.section_paths.includes(s.path)):state.body_sections;
    const unverified=selected.filter(s=>s.status==='ready'&&!s.validated_action_ids?.includes(record.action_id));
    validationMissing=unverified.length>0;
    missing.push(...unverified.map(s=>s.title+'未通过本轮校验'));
   }
   if(record.kind==='outline'&&!manualDirectoryCurrent(state,record)){const verification=await business(this.ctx,'outline_status',{task_id:record.task_id,action_id:record.action_id});if(!verification.ok)missing.push(verification.error)}
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
  if(view.state==='failed')view.resolved=!validationMissing&&actionSatisfied(state,record);
  return view;
 }
 async tasks(){const result=await business(this.ctx,'tasks');let recovered=false;for(const task of result.tasks)if(task.review_status==='running'){const record=(await this.latestRecord(task.id,'review'))?.record;if(record)recovered=await this.recoverReview(record)||recovered}return recovered?business(this.ctx,'tasks'):result}
 async artifacts(tid){return business(this.ctx,'route',{method:'GET',path:'/artifacts',query:{task_id:tid}})}
 async latestRecord(tid,kind){
  const dir=join(actions,tid);let names;try{names=await readdir(dir)}catch(e){if(e.code==='ENOENT')return null;throw e}
  const records=[];for(const name of names.filter(n=>n.endsWith('.json')&&n!=='latest.json')){const path=join(dir,name),record=await jsonFile(path);if(record.kind===kind)records.push({record,path})}return records.sort((a,b)=>b.record.created_at-a.record.created_at)[0]??null;
 }
 async state(tid){let record=await jsonFile(join(actions,tid,'latest.json'));if(record&&(await this.handle(record)).agent.status!=='running'){await this.settling.get(tid);record=await jsonFile(join(actions,tid,'latest.json'))}if(record?.kind==='review')await this.recoverReview(record);record=await jsonFile(join(actions,tid,'latest.json'));const base=await business(this.ctx,'state',{task_id:tid});const execution=record?await this.projection(record,base):null;const analysis=(await this.latestRecord(tid,'analyse'))?.record;const conversation=await jsonFile(join(dataRoot,'conversations',tid+'.json'));return {...base,session_id:conversation?.session_id??null,workflow:await this.workflows.snapshot(tid),analysis_progress:analysis?.analysis_progress??analysisProgress(base.files,analysis?.analysis_before,analysis?.created_at),execution}}
 async assertIdle(tid){if(this.admissions.has(tid))throw new BusinessError(409,'当前项目正在提交');return this.idleState(tid)}
 async idleState(tid){if(this.workflows.active(tid))throw new BusinessError(409,'项目自动流程正在执行，请先停止');const state=await this.state(tid);if(['running','needs_input'].includes(state.execution?.state))throw new BusinessError(409,'当前项目正在执行，请先停止或填写具体选项');await this.settling.get(tid);await this.freezeAnalysis(tid);return state}
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
 async reviewDecision(tid,payload){this.admit(tid,'当前项目正在提交');try{const state=await this.idleState(tid);if(!state.review.report||state.review.report.created_at!==payload.report_created_at)throw new BusinessError(409,'当前报告已变化，请读取最新报告');return await business(this.ctx,'review_decide',{task_id:tid,...payload})}finally{this.release(tid)}}
 async saveBidder(tid,payload){
  this.admit(tid,'当前项目正在提交');
  try{await this.idleState(tid);return await business(this.ctx,'route',{method:'PUT',path:'/projects/'+tid+'/bidder',body:payload})}
  finally{this.release(tid)}
 }
 async requireCurrent(tid,kind,state){
  if(kind==='outline'&&manualDirectoryCurrent(state))return;
  const record=(await this.latestRecord(tid,kind))?.record;
  if((['guide','promises'].includes(kind)&&state.build_preparation[kind]!=='ready')||(!['guide','promises'].includes(kind)&&(!record||record.input_version!==state.input_versions[kind]||(await this.projection(record)).state!=='completed')))throw new BusinessError(409,{analyse:'解读依据已变化，请重新解读',outline:'目录依据已变化，请重新生成目录',guide:'写作指引依据已变化，请重新生成写作指引',promises:'承诺清单依据已变化，请重新生成关键事实与承诺'}[kind]);
 }
 async action(tid,payload,options={}){
  if(this.workflows.active(tid)&&this.workflows.records.get(tid)?.id!==options.workflowId)throw new BusinessError(409,'项目自动流程正在执行，请先停止');
  this.admit(tid,'操作正在提交，请读取最新状态');
  try{
   if(!instructions[payload.kind]||typeof payload.request_id!=='string'||payload.request_id.length<8)throw new BusinessError(422,'操作参数无效');
   if(payload.read_only!==undefined&&(typeof payload.read_only!=='boolean'||payload.read_only&&payload.kind!=='revise'))throw new BusinessError(422,'read_only只接受布尔值，且只读核验使用revise阶段');
   const dir=join(actions,tid);await mkdir(dir,{recursive:true});const key=createHash('sha256').update(payload.request_id).digest('hex');const path=join(dir,key+'.json');const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');const old=await jsonFile(path);
   if(old){if(old.payload_hash!==hash)throw new BusinessError(409,'同一请求的操作内容已变化');return {session_id:old.session_id,action_id:old.action_id,replayed:true}}
   const active=await jsonFile(join(dir,'latest.json'));
   if(active&&active.end_seq==null&&!active.stopped_at&&this.executionOwners.get(tid)?.actionId===active.action_id&&this.executionOwners.get(tid)?.waitingForIdle&&this.ctx.agents.get(active.session_id)?.status==='running')throw new BusinessError(409,'当前项目阶段正在执行，请直接按已收到的阶段指令完成所选范围，不要再次调用run启动阶段');
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
   const cwd=join(dataRoot,'workspace',tid);await this.skillsLink(cwd);
   await writeFile(join(locks,tid),String(process.pid),{flag:'wx'});
   let handle;const previous=await jsonFile(join(dir,'latest.json'));
   try{
    handle=await this.conversation(tid,this.ctx.agentDefaultModel.currentSelection(),options.agent);if(!options.agent&&handle.agent.status==='running')throw new BusinessError(409,'项目会话正在执行，请等待或停止当前对话');const sessionId=handle.agent.id;
    const model=await this.select(payload.kind,this.modelSelection(handle.agent));
    Object.assign(handle.agent.options,{...model,reasoningEffort:model.reasoningEffort,maxTokens:model.maxTokens});
    this.ctx.get('permissionPresets')?.set(handle.agent.session,'danger-full-access');
    if(this.ctx.get('sessionTitle'))await this.ctx.sessionTitle.rename(handle.agent.session,state.task.title);
    const section_paths=state.body_sections.filter(s=>payload.kind==='build'?(s.status==='missing'||s.status==='draft'):sections.some(p=>p.volume===s.volume&&p.title===s.title)).map(s=>s.path);
    const history_before_seq=options.agent?(handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/start')?.seq??0):handle.agent.session.seq;
    const record={history_before_seq,action_id:key,start_seq:handle.agent.session.snapshotEvents().length,session_id:sessionId,task_id:tid,kind:payload.kind,read_only:payload.read_only===true,instruction:payload.instruction??'',model,payload_hash:hash,input_version:(await business(this.ctx,'state',{task_id:tid})).input_versions[payload.kind],created_at:Date.now(),sections,section_paths,...(payload.kind==='analyse'?{analysis_sources:await business(this.ctx,'analysis_source_version',{task_id:tid})}:{}),...(payload.kind==='analyse'?{analysis_before:Object.fromEntries(state.files.map(f=>[f.path,f.hash]))}:{})};
    await atomic(path,record);await atomic(join(dir,'latest.json'),record);
    const prompt=(record.read_only?readOnlyInstruction:instructions[payload.kind])+(payload.kind==='review'?'\n审核中的招标条款歧义、来源冲突、外部事实或证明不足，直接在报告“需确认”中列出原文依据、影响及尚待确认的范围，继续完整审核，不调用ask_user_question让用户逐项裁决。只有缺少开始审核所必需的文件或无法识别受审对象才提问；修改业务规则或替用户作新的承诺须询问。':'')+'\n页面输入：'+JSON.stringify(payload)+'\n制作状态：'+JSON.stringify(state.build_preparation)+'；目录篇幅：'+JSON.stringify(state.directory?.content.page_target??null)+(bidderSnapshot?'\n已确认投标主体信息（唯一身份依据，仅供本轮明确任务使用，不构成新增填写授权）：'+JSON.stringify(bidderSnapshot)+'。仅在本轮明确要求涉及这些字段时使用已有值，不再次提问；不因快照、缺口或通用技能而扩大任务范围。公司资质与业绩只检索本主体；写作素材全库共用，使用方式遵守当前阶段。':'')+'\n'+taskPathContext(tid)+'\n来源集合以当前任务 work/parse/sources.json 为准。';
    const outlineContext=payload.kind==='outline'?await business(this.ctx,'outline_begin',{task_id:tid,action_id:key}):null;
    const currentDirectory=state.directory&&payload.kind!=='outline'?'\n当前有效投标目录：'+JSON.stringify({contract:'tender.directory/tender-response-docs@1',artifact_id:state.directory.artifact_id,content_seq:state.directory.content_seq})+'。当前上下文已有本版本所需内容则复用；缺失时先用read_artifact的index查看范围，再按section读取当前章节及其依据，必须传索引返回的content_seq、完整册名volume和section_path；不传空册名。只有确需完整全局JSON才用full。人工调整是当前目录依据，不沿用旧标题、顺序、层级。':'';
    const stagePrompt=(outlineContext?prompt+'\n本轮目录派发/汇总契约：'+JSON.stringify(outlineContext):prompt)+currentDirectory+'\n阶段交接：用户原始消息和问答保留；旧阶段工具执行记录按路径归档，不能把旧结论当作当前证据。八份解读及用户裁决以work/analysis/下的现行文件（含clarifications.md）为准；主体、目录和制作承诺使用当前版本，完整引用须回查work/parse/原文。正文、准备文件及现有质量校验按本阶段技能读取执行。';
    record.prompt=stagePrompt;await this.updateRecord(record,{prompt:stagePrompt});await this.applyStageTools(handle.agent,payload.kind,record.read_only);
    if(!options.agent)handle.agent.followup(createUserMessage({content:[{type:'text',text:stagePrompt}],source:{kind:'human'}}));
    this.track(handle,tid,key);return {session_id:sessionId,action_id:key,instructions:stagePrompt,replayed:false};
   }catch(e){await unlink(join(locks,tid)).catch(()=>{});await unlink(path).catch(()=>{});if(previous)await atomic(join(dir,'latest.json'),previous);else await unlink(join(dir,'latest.json')).catch(()=>{});throw e}
  }finally{this.release(tid)}
 }
 async freezeAnalysis(tid,sessionId){const entry=await this.latestRecord(tid,'analyse');if(!entry||(sessionId&&entry.record.session_id!==sessionId)||entry.record.analysis_progress)return;const view=await this.projection(entry.record);if(['running','needs_input'].includes(view.state))return;const state=await business(this.ctx,'state',{task_id:tid});entry.record.analysis_progress=analysisProgress(state.files,entry.record.analysis_before,entry.record.created_at);await atomic(entry.path,entry.record)}
 async preparationProblem(tid,sessionId,message){const record=await jsonFile(join(actions,tid,'latest.json'));if(record?.session_id===sessionId)await this.updateRecord(record,{preparation_error:message})}
 async writeReviewState(record,finished_state,review_error){await this.updateRecord(record,{finished_state,review_error})}
 async verifyCompleted(tid){
  const record=await jsonFile(join(actions,tid,'latest.json'));
  if(record?.outcome?.state==='completed'&&['outline','guide','promises','body','revise','build'].includes(record.kind)&&(await this.projection(record)).state==='completed')await this.updateRecord(record,{verified_completed_at:Date.now()});
 }
 async reviewProgress(tid,sessionId){return business(this.ctx,'review_progress',{task_id:tid,session_id:sessionId})}
 async continueReview(tid,actionId){
  this.admit(tid,'操作正在提交，请读取最新状态');
  try{
   await this.settling.get(tid);
   const record=await jsonFile(join(actions,tid,'latest.json'));
   if(record?.action_id!==actionId||record.kind!=='review'||record.stopped_at||record.finished_state!=='failed')throw new BusinessError(409,'本轮审查不能继续，请读取最新状态');
   const state=await business(this.ctx,'state',{task_id:tid});
   if(record.input_version!==state.input_versions.review)throw new BusinessError(409,'审查依据已变化，请重新审核');
   const handle=await this.handle(record);
   if(handle.agent.status==='running')throw new BusinessError(409,'当前审查尚未结束');
   await writeFile(join(locks,tid),String(process.pid),{flag:'wx'});
   try{
    await this.updateRecord(record,{outcome:null,end_seq:null,start_seq:handle.agent.session.snapshotEvents().length,finished_state:undefined,review_error:undefined,continuations:(record.continuations??0)+1});
    this.assertOpen();if(this.workflows.records.get(tid)?.state==='stopped')throw new BusinessError(409,'自动流程已停止');
    handle.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'本轮审查尚未完成，继续同一执行和本轮已保存批次，不调用run、不重新开始审查。用review_batch读取当前未完成批次；已保存结果保留，需要更正时回读对应batch_id。必须继续到complete，再调用finish_review_report生成正式报告。单次回复结束不代表审查完成，不因估计令牌预算而提前收尾；上下文由宿主管理。全部完成后展示真实报告摘要与整册Word下载链接。'}]}));
    this.track(handle,tid,record.action_id);
   }catch(error){await unlink(join(locks,tid)).catch(()=>{});throw error}
  }finally{this.release(tid)}
 }
 async finishReview(record,handle){let finished=this.executionView(record,handle.agent).state;let review_error;if(finished==='completed'&&!record.stopped_at){try{await business(this.ctx,'review_finish',{task_id:record.task_id,session_id:record.session_id})}catch(error){finished='failed';review_error=error.message}}await this.writeReviewState(record,finished,review_error)}
 async recoverReview(record){if(record.finished_state||this.settling.has(record.task_id))return false;const handle=await this.handle(record);if(handle.agent.status==='running')return false;await this.finishReview(record,handle);return true}
 track(handle,tid,actionId){
  const owner={actionId,agent:handle.agent,waitingForIdle:true};this.executionOwners.set(tid,owner);
  const done=handle.agent.whenIdle().then(async()=>{
   owner.waitingForIdle=false;owner.endSeq=handle.agent.session.snapshotEvents().at(-1)?.seq;
   owner.questions=structuredClone(this.ctx.sessionProjections.snapshot(handle.agent.session,['userQuestions']).values.userQuestions??{});
   await this.ctx.sessions.flush(handle.agent.session);
   let record=await jsonFile(join(actions,tid,'latest.json'));if(record?.action_id!==actionId)return;
   const view=this.executionView(record,handle.agent);
   await this.updateRecord(record,{outcome:{state:view.state,error:view.error,questions:view.questions},...(view.state==='needs_input'?{}:{end_seq:owner.endSeq})});
   record=await jsonFile(join(actions,tid,'latest.json'));
   if(record.kind==='review')await this.finishReview(record,handle);
   if(record.kind==='analyse')await this.freezeAnalysis(tid,record.session_id);
   if(['guide','promises'].includes(record.kind)&&this.executionView(record,handle.agent).state==='completed'){
    try{await business(this.ctx,'record_preparation',{task_id:tid,stage:record.kind,session_id:record.session_id})}catch(error){await this.preparationProblem(tid,record.session_id,error.message)}
   }
   record=await jsonFile(join(actions,tid,'latest.json'));
   if(record?.action_id===actionId){await this.verifyCompleted(tid);return this.projection(record)}
  }).catch(e=>{console.error('ooo-bidpliot execution persistence:',e.message)}).finally(async()=>{
   await unlink(join(locks,tid)).catch(()=>{});
   if(this.settling.get(tid)===done){this.settling.delete(tid);this.executionOwners.delete(tid)}
  });
  this.settling.set(tid,done);
 }

 async stop(tid,sessionId,actionId){const dir=join(actions,tid),record=await jsonFile(join(dir,'latest.json'));if(record?.session_id!==sessionId||(actionId&&record.action_id!==actionId))throw new BusinessError(409,'当前执行已变化');const handle=await this.handle(record);record.stopped_at=Date.now();await this.updateRecord(record,{stopped_at:record.stopped_at});handle.agent.cancel({kind:'user'});await handle.agent.whenIdle();await this.ctx.sessions.flush(handle.agent.session);await this.settling.get(tid);await this.freezeAnalysis(tid,sessionId);await unlink(join(locks,tid)).catch(()=>{});return {ok:true}}
 async answer(tid,sessionId,body){const record=await jsonFile(join(actions,tid,'latest.json'));if(record?.session_id!==sessionId)throw new BusinessError(409,'当前问题已变化');const handle=await this.handle(record);const view=await this.projection(record);const current=view.questions.map(q=>q.callId);if(view.state!=='needs_input'||JSON.stringify(current)!==JSON.stringify(body.call_ids))throw new BusinessError(409,'本次问题已变化，请读取最新问题');
  if(!Array.isArray(body.batches)||body.batches.length!==view.questions.length)throw new BusinessError(422,'请填写全部具体选项');
  const batches=view.questions.map(q=>{const matches=body.batches.filter(b=>b.call_id===q.callId);const answers=matches[0]?.answers;if(matches.length!==1||!Array.isArray(answers)||answers.length!==q.questions.length||new Set(answers.map(a=>a.id)).size!==answers.length||q.questions.some(item=>!answers.some(a=>a.id===item.id)))throw new BusinessError(422,'问题与回答不一致');for(const item of q.questions){const a=answers.find(a=>a.id===item.id);if(!Array.isArray(a.selected)||a.selected.some(v=>typeof v!=='string'||!item.options?.some(o=>o.label===v))||new Set(a.selected).size!==a.selected.length||(!item.multiSelect&&a.selected.length>1)||(a.custom!==undefined&&typeof a.custom!=='string')||(!a.selected.length&&!a.custom?.trim()))throw new BusinessError(422,'请填写有效的选择或说明')}return {callId:q.callId,answers}});
  await this.settling.get(tid);await writeFile(join(locks,tid),String(process.pid),{flag:'wx'});
  try{await this.updateRecord(record,{outcome:null,end_seq:null,start_seq:handle.agent.status==='running'?handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/start').seq:handle.agent.session.snapshotEvents().length});if(record.kind==='review')await this.writeReviewState(record,undefined);for(const batch of batches){if(!this.ctx.userQuestions.answer(handle.agent,batch.callId,{answers:batch.answers}))throw new BusinessError(409,'问题已结束')}this.track(handle,tid,record.action_id);return {ok:true}}catch(e){await unlink(join(locks,tid)).catch(()=>{});throw e}
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
  let handle,stage='parse';
  try{
   const createAgent=async()=>{const cwd=join(dataRoot,'workspace','knowledge');await this.skillsLink(cwd);return this.ctx.agents.create({sessionId:'kb-'+randomUUID(),meta:{cwd,agentPreset:'ooo-bidpliot'},agentOptions:await this.select(),setup:async c=>{await this.ctx.agentPresets.mount(c,'ooo-bidpliot')}})};
   const prepared=await business(this.ctx,'kb_prepare',{id},{signal});
   if(prepared.needs_ocr){handle=await createAgent();await transcribe(this.ctx,prepared,{agent:handle.agent,signal})}
   await business(this.ctx,'kb_parsed',{id},{signal});stage='extract';
   await business(this.ctx,'kb_images',{id},{signal});
   handle??=await createAgent();
   const p=await business(this.ctx,'kb_prompt',{id},{signal});const run=await startSubtask(this.ctx,{parent:handle.agent,signal,role:'knowledge',label:'投标资料整理',prompt:[{type:'text',text:p.prompt}]});
   try{const result=await run.result;signal.throwIfAborted();if(result.stopReason!=='completed')throw await subagentFailure(this.ctx,run,result,'资料整理未完成');const text=result.output.filter(b=>b.type==='text').map(b=>b.text).join('');await business(this.ctx,'kb_finish',{id,metadata:jsonResponse(text)},{signal})}finally{await run.dispose()}
  }catch(e){await business(this.ctx,'kb_fail',{id,stage,error:signal.aborted?'资料处理已中断，请重试':e.message})}finally{await handle?.dispose()}
 }
 close(){
  if(this.closing)return this.closing;
  this.closed=true;
  return this.closing=(async()=>{
   for(const handle of this.handles.values())if(handle.agent.status==='running')handle.agent.cancel({kind:'user'});
   await this.workflows.close();
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
   this.handles.clear();this.guardOff?.();this.continuationOff?.();this.requestOff?.();for(const entry of this.stageTools.values())await entry.fiber?.dispose();this.stageTools.clear();
   for(const unregister of this.presetDisposers.splice(0).reverse())await unregister();
   const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
   if(failures.length)throw new AggregateError(failures,'ooo-bidpliot 会话关闭失败');
  })();
 }
}
