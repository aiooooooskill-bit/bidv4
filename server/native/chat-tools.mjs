import {createWriteStream} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,basename,extname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {business,dataRoot,BusinessError} from './business.mjs';
const output={schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]};
const text=value=>JSON.stringify(value);
const idOf=exec=>createHash('sha256').update(exec.agent.id+':'+exec.callId).digest('hex');
export async function chatAttachments(ctx,agent){
 const observation=await ctx.sessionQuery.observeSession(agent.id,{projectionMode:'none'});
 try{const refs=new Map();for(const event of observation.events){if(event.type!=='user/message')continue;for(const block of event.data.content??event.data.message?.content??[])if(['file','image'].includes(block.type)&&block.attachment)refs.set(block.attachment.attachmentId,{type:block.type,...block.attachment})}return [...refs.values()]}finally{observation[Symbol.dispose]()}
}
export async function projectStatus(ctx,tid,link){
 const state=await ctx.bidBusiness.state(tid),{artifacts}=await ctx.bidBusiness.artifacts(tid);
 return {task_id:tid,title:state.task.title,stage:state.task.stage,execution:state.execution,workflow:state.workflow,bidder:state.bidder,sources:state.source_selection,review:reviewSummary(state.review),
  outputs:artifacts.filter(a=>a.kind==='tender.volume'&&state.volume_states.some(v=>v.status==='ready'&&v.artifact_id===a.artifact_id)).map(a=>({name:a.display_name,link:link('/api/bidv4/artifacts/'+a.artifact_id+'/file')})),
  documents:[...new Set([...state.files.map(f=>f.path),...(state.body_files??[])])].map(path=>({name:path.split('/').pop(),path,link:link('/api/bidv4/workbench/raw?'+new URLSearchParams({task_id:tid,path}))}))};
}
export function reviewSummary(review){
 const envelope=review.report,report=envelope?.completed&&envelope.input_version===review.input_version?envelope.report:null;
 const issues=report?[...report.issues,...report.document_issues]:[];
 return {status:review.status,report_ready:!!report,completed:!!report&&review.status==='reviewed',reviewed_items:report?.requirements.length??0,
  issue_counts:Object.fromEntries([['disqualification','可能废标'],['scoring','评分失分风险'],['confirmation','需确认'],['suggestion','建议修改']].map(([key,label])=>[label,issues.filter(i=>i.risk_type===key).length])),
  total_issues:issues.length,summary_items:report?.summary_items??[]};
}
export function registerChatTools(ctx,link){
 const runtime=ctx.bidBusiness,names=[];
 const register=(name,description,properties,required,execute)=>{names.push(name);ctx.tools.register({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output,async execute(args,exec){return text(await execute(args,exec))}})};
 register('ooo_bidpliot_project','创建或配置与工作台共用的招投标项目。create需title；attachments列本会话原生上传附件；import只接受真实attachment_id与用途source/bid；company/representative保存用户明确提供的公司或代表资料；sources保存招标主文件与补充文件；bidder保存用户指定主体、签字代表和日期；review_files选择受审投标文件；library读取可选公司和代表。不要编造附件或公司编号。',{
  operation:{type:'string',enum:['create','attachments','import','sources','bidder','review_files','library','company','representative']},task_id:{type:'string'},title:{type:'string'},
  files:{type:'array',items:{type:'object',properties:{attachment_id:{type:'string'},purpose:{type:'string',enum:['source','bid']},name:{type:'string'}},required:['attachment_id'],additionalProperties:false}},
  company:{type:'object',properties:{id:{type:'string'},revision:{type:'integer'},name:{type:'string'},credit_code:{type:'string'},profile:{type:'object',additionalProperties:{type:'string'}}},required:['name'],additionalProperties:false},representative:{type:'object',properties:{id:{type:'string'},revision:{type:'integer'},name:{type:'string'},title:{type:'string'},phone:{type:'string'},email:{type:'string'}},required:['name'],additionalProperties:false},
  main_file:{type:'string'},supplements:{type:'array',items:{type:'string'}},bids:{type:'array',items:{type:'string'}},company_id:{type:'string'},signer_id:{type:'string'},sign_date:{type:'string'},
 },['operation'],async(args,exec)=>{
  if(args.operation==='attachments')return {attachments:await chatAttachments(ctx,exec.agent)};
  if(args.operation==='library'){const value=await business(ctx,'route',{method:'GET',path:'/library/overview',query:{}});return {companies:value.companies,representatives:value.representatives}}
  if(['company','representative'].includes(args.operation))return business(ctx,'route',{method:'POST',path:args.operation==='company'?'/library/companies':'/library/representatives',body:args[args.operation]},{signal:exec.signal});
  if(args.operation==='create'){const value=await business(ctx,'create_task',{title:args.title,request_id:idOf(exec).slice(0,32)});await runtime.bindConversation(value.task.id,exec.agent);return value}
  const tid=args.task_id;if(!tid)throw new BusinessError(422,'请选择项目');await runtime.bindConversation(tid,exec.agent);await runtime.assertIdle(tid);
  if(args.operation==='import'){
   if(!args.files?.length)throw new BusinessError(422,'请选择已上传的附件');
   const attachments=await chatAttachments(ctx,exec.agent),imported=[];
   for(const item of args.files){
    const ref=attachments.find(a=>a.attachmentId===item.attachment_id);if(!ref)throw new BusinessError(422,'附件不属于本次对话');
    const name=basename(item.name??ref.name??('附件-'+ref.attachmentId.slice(0,8)+'.'+(ref.mediaType?.split('/')[1]??'png')));
    if(!['.docx','.pdf','.png','.jpg','.jpeg','.gif','.webp'].includes(extname(name).toLowerCase()))throw new BusinessError(415,'附件格式不支持');
    if(item.purpose!=='bid'&&ref.bytes>100*1024*1024)throw new BusinessError(413,'招标来源文件超过100MB上限');
    await mkdir(join(dataRoot,'uploads'),{recursive:true});const directory=await mkdtemp(join(dataRoot,'uploads/chat-'));
    try{const path=join(directory,'file');if(ref.type==='image')await writeFile(path,(await ctx.attachments.readImage(ref)).data);else await pipeline(ctx.attachments.readFileStream(ref,exec.signal),createWriteStream(path));
     await business(ctx,'route',{method:'POST',path:'/files',query:{task_id:tid,...(item.purpose==='bid'?{purpose:'bid'}:{})},upload:{path,filename:name}},{signal:exec.signal});imported.push(name);
    }finally{await rm(directory,{recursive:true,force:true})}
   }
   return {task_id:tid,imported};
  }
  const state=await runtime.state(tid);
  if(args.operation==='sources')return runtime.saveSources(tid,{main_file:args.main_file,supplements:args.supplements??[],input_version:state.input_versions.analyse});
  if(args.operation==='bidder')return runtime.saveBidder(tid,{company_id:args.company_id,signer_id:args.signer_id,sign_date:args.sign_date,revision:state.bidder.revision});
  if(args.operation==='review_files')return runtime.saveReviewInput(tid,{bids:args.bids,input_version:state.input_versions.review});
  throw new BusinessError(422,'项目操作无效');
 });
 register('ooo_bidpliot_run','执行同一项目的解析解读、目录、制作、修订、审查或完整流程。analyse包含解析和八份解读；build含写作准备、正文和合册；full依次复用有效成果并完成解读、目录、制作、审查。返回阶段指令后由当前Agent直接执行，不创建其他Agent或会话。resume用于修复缺项或答复后继续原自动流程。不得把failed/needs_input宣称完成。',{
  task_id:{type:'string'},kind:{type:'string',enum:['analyse','outline','guide','promises','build','body','revise','review','full','stop']},resume:{type:'boolean'},main_file:{type:'string'},supplements:{type:'array',items:{type:'string'}},page_target:{type:['integer','null']},numbering:{type:'string',enum:['decimal','chapter','gov','none']},sections:{type:'array',items:{type:'object',properties:{volume:{type:'string'},title:{type:'string'}},required:['volume','title'],additionalProperties:false}},instruction:{type:'string'},
 },['task_id','kind'],async(args,exec)=>{
  const tid=args.task_id;await runtime.bindConversation(tid,exec.agent);
  if(args.kind==='stop')throw new BusinessError(409,'请使用原生停止按钮停止当前执行');
  // Settling waits for this Agent to become idle; awaiting it from its own turn deadlocks.
  if(runtime.executionOwners.get(tid)?.waitingForIdle&&runtime.executionOwners.get(tid)?.agent===exec.agent)throw new BusinessError(409,'当前阶段仍在本会话执行，请完成当前阶段并结束本轮；不要重复调用run。自动流程会继续后续阶段。');
  if(args.kind==='full'){
   const workflow=await runtime.workflows.start(tid,{...args,agent:exec.agent});
   const record=workflow.state==='running'?(await runtime.latestRecord(tid,workflow.stage))?.record:null;
   return {...await projectStatus(ctx,tid,link),...(record&&record.action_id===workflow.action_id?{instructions:record.prompt}:{})};
  }
  const state=await runtime.state(tid);const payload={...args,request_id:idOf(exec),input_version:state.input_versions[args.kind],...(args.kind==='analyse'?{main_file:args.main_file??state.source_selection.main,supplements:args.supplements??state.source_selection.supplements.map(s=>s.file)}:{}),...(args.kind==='outline'?{page_target:args.page_target??null,numbering:args.numbering??'decimal'}:{})};delete payload.task_id;delete payload.resume;
  const action=await runtime.action(tid,payload,{agent:exec.agent});return {...await projectStatus(ctx,tid,link),instructions:action.instructions};
 });
 register('ooo_bidpliot_answer','根据当前项目真实questions提交具体答复。字段与当前callId和问题id逐项对应；回答后继续同一执行，若处于自动流程则继续后续阶段。',{
  task_id:{type:'string'},batches:{type:'array',items:{type:'object',properties:{call_id:{type:'string'},answers:{type:'array',items:{type:'object',properties:{id:{type:'string'},selected:{type:'array',items:{type:'string'}},custom:{type:'string'}},required:['id','selected'],additionalProperties:false}}},required:['call_id','answers'],additionalProperties:false}},
 },['task_id','batches'],async(args,exec)=>{
  const state=await runtime.state(args.task_id);if(state.execution?.state!=='needs_input')throw new BusinessError(409,'项目当前没有待答问题');
  await runtime.bindConversation(args.task_id,exec.agent);
  await runtime.answer(args.task_id,state.execution.session_id,{call_ids:state.execution.questions.map(q=>q.callId),batches:args.batches});
  if(state.workflow?.action_id===state.execution.action_id&&['running','needs_input'].includes(state.workflow.state))runtime.workflows.resumeAfter(args.task_id,exec.agent);
  return {task_id:args.task_id,instructions:'答复已保存，在本会话继续未完成阶段。'};
 });
 register('ooo_bidpliot_read','读取真实成果以在原生对话中展示解读或最终内容。Markdown返回正文；review返回本轮完整审查报告。文件下载使用status/run返回的真实链接。',{
  task_id:{type:'string'},path:{type:'string'},report:{type:'boolean'},
 },['task_id'],async(args)=>args.report?(await runtime.state(args.task_id)).review:business(ctx,'route',{method:'GET',path:extname(args.path??'')==='.docx'?'/workbench/docx-view':'/workbench/content',query:{task_id:args.task_id,path:args.path}}));
 return names;
}
