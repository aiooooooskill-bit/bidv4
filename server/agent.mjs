import {scopeChainOf,scopeOf} from '@deepseek-ai/dsh-scope';
const display=text=>String(text??'').replace(/\b(?:MAND|REQ|TPL|SCORE|CLAR)[-_][A-Z0-9_-]+\b/gi,'').trim();
const statusTool='ooo_bidpliot_status';
export const name='ooo-bidpliot-display';export const inject=['tools','bidBusiness','agents','webServer'];
export function apply(ctx){
 // The host chat treats relative Markdown links as local files. Use the
 // official Web runtime's loopback address, without exposing its auth token.
 const link=path=>new URL(path,'http://127.0.0.1:'+ctx.webServer.port).href;
 ctx.tools.register({name:statusTool,description:'只读查看项目真实进度、dsh执行状态与文档。所有业务操作在页面进行。',parameters:{type:'object',properties:{task_id:{type:'string'}},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(args){
  if(!args.task_id){const {tasks}=await ctx.bidBusiness.tasks();return JSON.stringify({tasks:tasks.slice(0,20).map(t=>({id:t.id,title:display(t.title),stage:t.stage}))})}
  const state=await ctx.bidBusiness.state(args.task_id);const {artifacts}=await ctx.bidBusiness.artifacts(args.task_id);return JSON.stringify({task_id:args.task_id,stage:state.task.stage,execution:state.execution?{session_id:state.execution.session_id,state:state.execution.state,error:display(state.execution.error)}:null,outputs:artifacts.filter(a=>a.kind==='tender.volume').map(a=>({name:display(a.display_name),link:link('/api/bidv4/artifacts/'+a.artifact_id+'/file')})),documents:state.files.map(f=>({name:display(f.path.split('/').pop()),link:link('/api/bidv4/workbench/content?'+new URLSearchParams({task_id:args.task_id,path:f.path}))}))});
 }});
 // A preset is an ancestor scope. Restrict each joined Agent so the status
 // tool it inherits stays visible while host write/command tools are masked.
 const compositionScope=scopeOf(ctx),installed=new Map(),installing=new Set();
 const belongs=agent=>scopeChainOf(scopeOf(agent.ctx)).includes(compositionScope);
 const install=agent=>{
  if(installed.has(agent))return installed.get(agent);
  if(installing.has(agent))return;
  installing.add(agent);
  try{
   const fiber=agent.ctx.inject(['tools'],c=>{c.tools.restrict({allow:[statusTool]})});
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
