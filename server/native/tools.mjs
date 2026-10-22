import {defineTool} from '@deepseek-ai/dsh-tools';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {business,dataRoot,taskPathContext} from './business.mjs';
import {startSubtask,subagentFailure,subtaskRole} from './subtasks.mjs';
import {subtaskTools,subtaskProfiles,writingReadTools} from './preset.mjs';
import {reviewBatchResult} from './review-context.mjs';
export {startSubtask,subagentFailure} from './subtasks.mjs';
const roles=JSON.parse(await readFile(new URL('./roles.json',import.meta.url),'utf8'));
export const name='bid-business-tools';
export const inject=['agents','tools','subprocess','subagents','llm','systemPrompt','sessionQuery'];
import {taskForAgent} from './conversations.mjs';
import {outlineAssignments,chapterTools} from './execution-guard.mjs';
import {reserveBodyAssignment,BodyTaskSlots,bodyAssignment} from './body-assignments.mjs';
const failurePrefixes={docx_section_create:'[创建失败]',docx_section_revise:'[修订失败]',docx_section_read:'[读取失败]',docx_material_inject:'[注入失败]',docx_source_inject:'[注入失败]',docx_image_insert:'[插图失败]',docx_comment_add:'[批注失败]',docx_diagram_insert:['[图示失败]','[图示渲染失败]'],docx_html_figure:['[原型失败]','[原型渲染失败]'],docx_assemble_volume:'[合册失败]',assemble_tender:'[组装失败]',validate_body:'[校验失败]',publish_artifact:'[发布失败]',update_task_progress:'[更新失败]'};
const toolResult=(name,value)=>{if(typeof value==='string'&&failurePrefixes[name]&&[failurePrefixes[name]].flat().some(prefix=>value.startsWith(prefix)))throw new Error(value);return value};
const taskOf=agent=>taskForAgent(agent)??basename(agent.session.header.cwd);
export async function transcribe(ctx,prepared,exec){
 if(!prepared.needs_ocr)return prepared;
 const {provider,model}=exec.agent.session.requestHeader()?.config??exec.agent.options;
 const info=await ctx.llm.resolveModelInfo(provider,model,exec.signal);
 if(!info.inputModalities?.includes('image'))throw new Error('dsh当前模型未声明图片输入能力，请在已有模型设置中启用图片输入后重试');
 const outputs=[];
 for(const page of prepared.pages){
  exec.signal.throwIfAborted();
  await business(ctx,'ocr_page',{plan:prepared.plan,page:page.page},{signal:exec.signal});
  const run=await startSubtask(ctx,{parent:exec.agent,signal:exec.signal,label:'第'+page.page+'页文字识别',role:'ocr',prompt:[{type:'text',text:prepared.prompt+'\n调用read_image读取图片：'+page.path+'。仅返回Markdown转写。'}]});
  try{const result=await run.result;exec.signal.throwIfAborted();if(result.stopReason!=='completed')throw await subagentFailure(ctx,run,result,'图片识别未完成');const text=result.output.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(!text.trim())throw new Error('图片识别未返回文字');outputs.push({page:page.page,text})}finally{await run.dispose()}
 }
 return business(ctx,'ocr_finish',{plan:prepared.plan,outputs},{signal:exec.signal});
}
export async function apply(ctx){
 const bodySlots=new BodyTaskSlots(()=>ctx.subagents.config.maxActiveSubagents.get());
 const installed=new Map();
 const install=async agent=>{
  const role=subtaskRole(agent);if(!role||installed.has(agent))return;
  const assignment=role==='tender-body-writer'?await bodyAssignment(taskOf(agent),agent.id):null;
  const allow=assignment?.read_only?subtaskTools[role].filter(name=>writingReadTools.includes(name)):subtaskTools[role];
  const persona=assignment?.read_only?roles.find(value=>value.name===role).read_only_persona:subtaskProfiles[role].persona;
  const fiber=agent.ctx.inject(['tools','systemPrompt'],c=>{
   c.tools.restrict({allow});
   c.systemPrompt.section({name:'deployment:persona-prefix',order:c.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),text:persona});
  });installed.set(agent,fiber);
 };
 ctx.on('agent/created',({agent})=>install(agent));
 ctx.on('agent/disposed',({agent})=>{const fiber=installed.get(agent);installed.delete(agent);return fiber?.dispose()});
 ctx.effect(()=>async()=>{await Promise.all([...installed.values()].map(fiber=>fiber.dispose()));installed.clear()},'ooo-bidpliot: internal role composition');
 // The official DSL leaves the root open. Its validator shares this schema object.
 const registerNative=options=>{const tool=defineTool(options);tool.parameters.additionalProperties=false;ctx.tools.register(tool)};
 const schemas=await business(ctx,'schemas');
 for(const definition of schemas){ctx.tools.register({...definition,output:{schema:{},render:(_args,value)=>[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]},async execute(parameters,exec){
  const taskId=taskOf(exec.agent);let active;try{active=JSON.parse(await readFile(resolve(dataRoot,'actions',taskId,'latest.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(active?.kind==='review'&&!['review_basis','review_batch','save_review_batch','finish_review_report'].includes(definition.name))throw new Error('当前审查仅允许读取文件与保存审查依据和报告');if(definition.name==='review_batch'&&!parameters.batch_id){const batch=await business(ctx,'tool',{name:definition.name,parameters},{signal:exec.signal,taskId,sessionId:exec.agent.session.id,callId:exec.callId});return reviewBatchResult(batch,exec.agent.session.deriveMessages())}if(!['publish_artifact','assemble_tender','update_task_progress','docx_section_create','docx_material_inject','docx_source_inject','docx_image_insert','docx_comment_add','docx_diagram_insert','docx_html_figure','docx_section_revise','docx_section_repartition','docx_assemble_volume','save_review_batch','finish_review_report'].includes(definition.name))return toolResult(definition.name,await business(ctx,'tool',{name:definition.name,parameters},{signal:exec.signal,taskId,sessionId:exec.agent.session.id,callId:exec.callId}));const key=createHash('sha256').update(exec.agent.session.id+':'+exec.callId).digest('hex');const dir=resolve(dataRoot,'tool-receipts',taskId);await mkdir(dir,{recursive:true});const path=resolve(dir,key+'.json');
  let receipt;try{receipt=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(receipt?.result!==undefined)return toolResult(definition.name,receipt.result);
  if(receipt)throw new Error('该工具的上次结果不确定，请先读取实际成果再决定下一步，不能直接重复写入');
  await writeFile(path,JSON.stringify({name:definition.name,parameters}),{flag:'wx'});
  let result;
  try{result=await business(ctx,'tool',{name:definition.name,parameters},{signal:exec.signal,taskId,sessionId:exec.agent.session.id,callId:exec.callId})}
  catch(error){
   // Transactional section writes reject without publication; other failures stay uncertain.
   if(!chapterTools.has(definition.name)||error.status!==422)throw error;
   result=[failurePrefixes[definition.name]].flat()[0]+' '+error.message;
  }
  if(definition.name==='save_review_batch')result=await business(ctx,'review_accept_batch',{task_id:taskId,session_id:exec.agent.session.id,candidate:result},{signal:exec.signal});
  await writeFile(path+'.tmp',JSON.stringify({name:definition.name,parameters,result}));await rename(path+'.tmp',path);return toolResult(definition.name,result);
 }})}
 ctx.tools.register({name:'prepare_review_documents',description:'解析本次招标依据与投标文件，复用现有解析器与同模型OCR，返回双方解析稿、大纲绝对路径和document_id。按document-parse及tender-review技能执行，先读大纲再逐项对照，不改写投标文件。',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_args,exec){const task_id=taskOf(exec.agent);for(const item of await business(ctx,'review_prepare',{task_id},{signal:exec.signal}))await transcribe(ctx,item.prepared,exec);return business(ctx,'review_documents',{task_id},{signal:exec.signal})}});

 registerNative({name:'parse_document',description:'解析已上传来源；file_name 只传含扩展名的原文件名，不传目录。扫描页与图片使用同一dsh模型，返回Markdown、大纲及元信息的绝对路径。',parameters:{file_name:{type:'string',required:true}},output:{schema:{type:'object',properties:{},additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute({file_name},exec){return transcribe(ctx,await business(ctx,'prepare',{task_id:taskOf(exec.agent),file_name},{signal:exec.signal}),exec)}});
 registerNative({name:'task',isConcurrencySafe:args=>args.subagent_type==='tender-body-writer',description:roles.map(r=>r.name+'：'+r.description).join('\n')+'。目录任务先outline_plan(operation="begin")承接分册骨架，response_file填写骨架中的册名；完成后返回JSON文本，含response_file、fragment_path绝对路径和summary，主Agent按fragment_path读取合并，不从册名拼接文件名。主子Agent使用同一模型。',parameters:{subagent_type:{type:'string',required:true,enum:roles.map(r=>r.name)},description:{type:'string',required:true},response_file:{type:'string',description:'目录子任务必填本轮计划中的完整册名；正文子任务不填'}},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute({subagent_type,description,response_file},exec){
  const role=roles.find(r=>r.name===subagent_type);const taskId=taskOf(exec.agent);
  let outline,body;
  if(role.name==='tender-outline-writer'){
   if(!response_file)throw new Error('目录子任务必须填写response_file，并先调用outline_plan承接本项目分册骨架');
   outline=await business(ctx,'outline_dispatch',{task_id:taskId,name:response_file},{signal:exec.signal});
   description+='\n本轮目录依据与原结构约束：'+JSON.stringify(outline)+'\n先read context_path及facts_path完整评分/需求原文，保留baseline中本册全部原节点、路径、顺序、scope、交付形态、归位理由与概述。只在原章下补分类；独立附件不降挂。一级综合章明确列出多个方案类别时，先按本项目适用类别设L2，相应独立评分子维度设L3；已有类别标题复用，不能跳过类别把子维度直接列为L2。不只核对评分，还须逐类核对文件组成/格式条款明确命名的方案类别，综合用户要求与已有正文补齐适用类别及下级内容；无评分、正文尚缺或其他部分未读到，不能据此漏掉已知类别。“如有要求”逐类核验，不将整组忽略。方案/能力/服务类别与具体数值参数不同，不能因类别内列参数或字段，就把独立评分类别只留在综合章概述或偏离表。来源按registry核定，纠正旧错标；不能沿用旧表行序。复用节点的REQ/MAND/TPL/SCORE全部按当前registry真实条文核对，不能把编号存在或已挂接当作语义正确；即使只重跑评分对齐，也不能只改SCORE而保留已发现的REQ等错标。仅纠正引用，原节点、归位理由和概述继续保留。已有fragment优先局部edit补缺与纠正来源，未改处保持原文；无fragment才write新建。只写fragment_path，不调用主流程技能，不读取其他册，不组装发布。'+(outline.phase==='classification_frozen'?'分类已冻结：须落实volume.headings/bindings；不得下调要求。':'当前仅锁定原结构，空headings不表示无需分类；按本项目原文完整完成初稿与三道清理，明确独立实质分类分别补实际L2/L3，之后主线程将回读实际目录逐项审查。完成后程序先检查原结构/内容保留；这不代表最终评分分类验收通过。');
  }
  if(role.name==='tender-body-writer'){
   body=await business(ctx,'dispatch_context',{description},{signal:exec.signal,taskId});
   description=body.description;
   const bidder=await business(ctx,'bidder_snapshot',{task_id:taskId},{signal:exec.signal});
   description+='\n已确认投标主体与签字信息（仅作事实依据，不构成补写授权；仅在本轮要求范围内使用已有值）：'+JSON.stringify(bidder.snapshot)+'\n仅在本轮要求范围内读取或使用资料：公司资料按本主体，人工核对值用 read_company_asset；写作素材全库共用，使用方法按当前阶段，不因提供事实快照而增加补写或注入。';
  }
  description+='\n'+taskPathContext(taskId);
  const childId=randomUUID();let run,releaseAssignment,releaseSlot;
  if(outline)outlineAssignments.set(childId,outline.fragment_path);
  try{
   if(body){releaseAssignment=await reserveBodyAssignment(ctx,taskId,childId,exec.agent.session.id,body.section_paths,exec.signal);releaseSlot=await bodySlots.acquire(exec.signal)}
   run=await startSubtask(ctx,{parent:exec.agent,signal:exec.signal,childId,label:role.description,role:role.name,prompt:[{type:'text',text:description}]});
   const result=await run.result;exec.signal.throwIfAborted();if(result.stopReason!=='completed')throw await subagentFailure(ctx,run,result,'子Agent未完成');
   if(outline)await business(ctx,'outline_check',{task_id:taskId,volume:response_file,child_completed:true},{signal:exec.signal});
   await business(ctx,'inherit_asset_reads',{task_id:taskId,session_id:exec.agent.session.id,from_session_id:run.childId},{signal:exec.signal});
   const summary=result.output.filter(b=>b.type==='text').map(b=>b.text).join('\n');
   return outline?JSON.stringify({response_file,fragment_path:outline.fragment_path,summary}):summary;
  }finally{outlineAssignments.delete(childId);try{await run?.dispose()}finally{releaseSlot?.();await releaseAssignment?.()}}
 }});
}
