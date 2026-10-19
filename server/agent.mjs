import {scopeChainOf,scopeOf} from '@deepseek-ai/dsh-scope';
import {join} from 'node:path';
import {dataRoot} from './native/business.mjs';
import {taskForAgent} from './native/conversations.mjs';
import {registerChatTools,projectStatus,chatAttachments} from './native/chat-tools.mjs';
const display=text=>String(text??'').replace(/\b(?:MAND|REQ|TPL|SCORE|CLAR)[-_][A-Z0-9_-]+\b/gi,'').trim();
const statusTool='ooo_bidpliot_status';
export const name='ooo-bidpliot-agent';export const inject=['tools','bidBusiness','agents','webServer','attachments','sessionQuery','subprocess','systemPrompt'];
export const chatToolNames=[statusTool,'ooo_bidpliot_project','ooo_bidpliot_run','ooo_bidpliot_answer','ooo_bidpliot_read'];
export function apply(ctx){
 const allowed=[...chatToolNames,...ctx.bidBusiness.toolNames,'read','read_image','write','edit','glob','grep','skill','ask_user_question','parse_document','task','prepare_review_documents'];
 ctx.tools.presentAs('native');
 // The host chat treats relative Markdown links as local files. Use the
 // official Web runtime's loopback address, without exposing its auth token.
 const link=path=>new URL(path,'http://127.0.0.1:'+ctx.webServer.port).href;
 const actionTools=registerChatTools(ctx,link);
 ctx.tools.register({name:statusTool,description:'读取工作台共用的项目、真实执行状态、待答问题、主体信息、成果和下载链接；未指定项目则列出项目和本对话上传附件。',parameters:{type:'object',properties:{task_id:{type:'string'}},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(args,exec){
  if(!args.task_id){const {tasks}=await ctx.bidBusiness.tasks();return JSON.stringify({tasks:tasks.slice(0,20).map(t=>({id:t.id,title:display(t.title),stage:t.stage})),...(exec?.agent?{attachments:await chatAttachments(ctx,exec.agent)}:{})})}
  const value=await projectStatus(ctx,args.task_id,link);value.outputs=value.outputs.map(o=>({...o,name:display(o.name)}));value.documents=value.documents.map(d=>({...d,name:display(d.name)}));return JSON.stringify(value);
 }});
 // Restrict this preset to its business tools, including after recompose.
 const compositionScope=scopeOf(ctx),installed=new Map(),installing=new Set();
 const belongs=agent=>scopeChainOf(scopeOf(agent.ctx)).includes(compositionScope);
 const install=agent=>{
  if(installed.has(agent))return installed.get(agent);
  if(installing.has(agent))return;
  installing.add(agent);
  try{
   const fiber=agent.ctx.inject(['tools','systemPrompt'],c=>{c.systemPrompt.context({name:'bid-project',order:900,text:()=>{const tid=taskForAgent(agent);return tid?'当前项目：'+tid+'；任务文件根目录：'+join(dataRoot,'workspace',tid)+'。所有文件访问使用该根目录的绝对路径。':''}});c.tools.restrict({allow:allowed})});
   installed.set(agent,fiber);return fiber;
  }finally{installing.delete(agent)}
 };
 const remove=agent=>{const fiber=installed.get(agent);if(!fiber)return;installed.delete(agent);return fiber.dispose()};
 const reconcile=()=>{for(const agent of ctx.agents.list())if(belongs(agent))install(agent);else remove(agent)};
 ctx.on('agent/created',async({agent})=>{await install(agent)});
 ctx.on('agent/disposed',({agent})=>{remove(agent)});
 ctx.on('tools/change',reconcile);
 ctx.effect(()=>async()=>{const fibers=[...installed.values()];installed.clear();await Promise.all(fibers.map(f=>f.dispose()))},'ooo-bidpliot-display: Agent restrictions');
 reconcile();
}
