import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {business,dataRoot} from './business.mjs';
const roles=JSON.parse(await readFile(new URL('./roles.json',import.meta.url),'utf8'));
export const name='bid-business-tools';
export const inject=['tools','subprocess','subagents','llm','systemPrompt'];
const taskOf=agent=>{let cwd=agent.session.header.cwd;return basename(cwd)};
export function subagentFailure(run,result,message){
 const reason=run.localAgent?.session.snapshotEvents().findLast(event=>event.type==='turn/end')?.data.reason;
 return new Error(result.diagnostic??(reason?.kind==='error'?reason.error?.message:undefined)??message);
}
export async function transcribe(ctx,prepared,exec){
 if(!prepared.needs_ocr)return prepared;
 const {provider,model}=exec.agent.options;
 const info=await ctx.llm.resolveModelInfo(provider,model,exec.signal);
 if(!info.inputModalities?.includes('image'))throw new Error('dsh当前模型未声明图片输入能力，请在已有模型设置中启用图片输入后重试');
 const outputs=[];
 for(const page of prepared.pages){
  exec.signal.throwIfAborted();
  await business(ctx,'ocr_page',{plan:prepared.plan,page:page.page},{signal:exec.signal});
  const run=await ctx.subagents.start('spawn',{parent:exec.agent,signal:exec.signal,label:'第'+page.page+'页文字识别',persona:prepared.prompt+'\n只调用read_image读取给定图片，然后返回完整转写，不修改任何文件，不提问。',toolFilter:{allow:['read_image']},prompt:[{type:'text',text:'调用read_image读取图片：'+page.path+'。仅返回Markdown转写。'}]});
  try{const result=await run.result;if(result.stopReason!=='completed')throw subagentFailure(run,result,'图片识别未完成');const text=result.output.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(!text.trim())throw new Error('图片识别未返回文字');outputs.push({page:page.page,text})}finally{await run.dispose()}
 }
 return business(ctx,'ocr_finish',{plan:prepared.plan,outputs},{signal:exec.signal});
}
export async function apply(ctx,config={}){
 const schemas=await business(ctx,'schemas');
 for(const definition of schemas.filter(d=>!config.review||['review_basis','review_batch','save_review_batch','finish_review_report'].includes(d.name))){ctx.tools.register({...definition,output:{schema:{},render:(_args,value)=>[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]},async execute(parameters,exec){
  const taskId=taskOf(exec.agent);if(!['publish_artifact','assemble_tender','update_task_progress','docx_section_create','docx_material_inject','docx_source_inject','docx_image_insert','docx_comment_add','docx_diagram_insert','docx_html_figure','docx_section_revise','docx_assemble_volume','save_review_batch','finish_review_report'].includes(definition.name))return business(ctx,'tool',{name:definition.name,parameters},{signal:exec.signal,taskId,sessionId:exec.agent.session.id,callId:exec.callId});const key=createHash('sha256').update(exec.agent.session.id+':'+exec.callId).digest('hex');const dir=resolve(dataRoot,'tool-receipts',taskId);await mkdir(dir,{recursive:true});const path=resolve(dir,key+'.json');
  let receipt;try{receipt=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(receipt?.result!==undefined)return receipt.result;
  if(receipt)throw new Error('该工具的上次结果不确定，请先读取实际成果再决定下一步，不能直接重复写入');
  await writeFile(path,JSON.stringify({name:definition.name,parameters}),{flag:'wx'});
  let result=await business(ctx,'tool',{name:definition.name,parameters},{signal:exec.signal,taskId,sessionId:exec.agent.session.id,callId:exec.callId});
  if(definition.name==='save_review_batch')result=await business(ctx,'review_accept_batch',{task_id:taskId,session_id:exec.agent.session.id,candidate:result},{signal:exec.signal});
  await writeFile(path+'.tmp',JSON.stringify({name:definition.name,parameters,result}));await rename(path+'.tmp',path);return result;
 }})}
 ctx.tools.register({name:'prepare_review_documents',description:'解析本次招标依据与投标文件，复用现有解析器与同模型OCR，返回双方解析稿、大纲绝对路径和document_id。按document-parse及tender-review技能执行，先读大纲再逐项对照，不改写投标文件。',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_args,exec){const task_id=taskOf(exec.agent);for(const item of await business(ctx,'review_prepare',{task_id},{signal:exec.signal}))await transcribe(ctx,item.prepared,exec);return business(ctx,'review_documents',{task_id},{signal:exec.signal})}});
 if(config.review)return;
 ctx.tools.register({name:'parse_document',description:'用灵燕原解析方法解析已上传来源；扫描页与图片使用同一dsh模型。产出Markdown、大纲及元信息。',parameters:{type:'object',properties:{file_name:{type:'string'}},required:['file_name'],additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute({file_name},exec){return transcribe(ctx,await business(ctx,'prepare',{task_id:taskOf(exec.agent),file_name},{signal:exec.signal}),exec)}});
 ctx.tools.register({name:'task',description:roles.map(r=>r.name+'：'+r.description).join('\n')+'。按灵燕原角色派发目录或正文写手；主子Agent使用同一模型。',parameters:{type:'object',properties:{subagent_type:{type:'string',enum:roles.map(r=>r.name)},description:{type:'string'}},required:['subagent_type','description'],additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute({subagent_type,description},exec){
  const role=roles.find(r=>r.name===subagent_type);const taskId=taskOf(exec.agent);
  if(role.name==='tender-body-writer'){
   description=await business(ctx,'dispatch_context',{description},{signal:exec.signal,taskId})??description;
   const bidder=await business(ctx,'bidder_snapshot',{task_id:taskId},{signal:exec.signal});
   description+='\n已确认投标主体与签字信息（直接读取已有值，不再次提问；签署日期只用本次确认值）：'+JSON.stringify(bidder.snapshot)+'\n公司资料仅检索本主体，精读人工核对值用 read_company_asset；写作素材全库共用，拷入后修订本项目内容与旧名。';
  }
  const run=await ctx.subagents.start('spawn',{parent:exec.agent,signal:exec.signal,label:role.description,persona:role.persona,toolFilter:role.name==='tender-body-writer'?{allow:['read','read_image','write','edit','glob','grep','skill','docx_section_create','docx_section_read','docx_section_revise','docx_diagram_insert','docx_html_figure','docx_source_inject','docx_material_inject','docx_image_insert','docx_comment_add','validate_body','check_name_residue','search_references','search_company_assets','read_company_asset','parse_document','fetch_url']}:{deny:['task','ask_user_question']},prompt:[{type:'text',text:description}]});
  try{
   const result=await run.result;if(result.stopReason!=='completed')throw subagentFailure(run,result,'子Agent未完成');
   await business(ctx,'inherit_asset_reads',{task_id:taskId,session_id:exec.agent.session.id,from_session_id:run.id},{signal:exec.signal});
   return result.output.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  }finally{await run.dispose()}
 }});
}
