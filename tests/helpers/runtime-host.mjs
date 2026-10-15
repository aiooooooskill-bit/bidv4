import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Context,symbols} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Group from '@deepseek-ai/cordis-plugin-group';

// Business events and sessions belong to this runtime; model routes and image
// objects belong to the host. Compose official plugins without changing them.
export async function createBusinessScope(parent,dataRoot){
 await mkdir(dataRoot,{recursive:true});
 const scope=new Context();
 let closing;
 const close=()=>closing??=(async()=>{await scope.fiber.dispose();while(scope.fiber.inertia)await scope.fiber.inertia})();
 try{
 for(const name of ['llm','agentDefaultModel','subprocess','attachments']){
  const service=parent.get(name);
  if(!service)throw new Error('Host service missing: '+name);
  scope.reflect.provide(name,service[symbols.original]??service);
 }
 await scope.plugin(Loader,{baseUrl:new URL('../../package.json',import.meta.url).href});
 scope.loader.builtins.group=Group;
 const plugins=[
  ['@deepseek-ai/dsh-fs-local',{}],
  ['@deepseek-ai/dsh-session-projection',{}],
  ['@deepseek-ai/dsh-session',{}],
  ['@deepseek-ai/dsh-session-query-sqlite',{path:':memory:',openAt:'never'}],
  ['@deepseek-ai/dsh-system-prompt',{includeHarnessIdentity:false,includeRuntimeContext:false}],
  ['@deepseek-ai/dsh-tools',{}],['@deepseek-ai/dsh-skill',{}],['@deepseek-ai/dsh-agent',{}],
  ['@deepseek-ai/dsh-session-persistence-jsonl',{root:join(dataRoot,'sessions'),compression:'none'}],
  ['@deepseek-ai/dsh-agent-preset-registry',{default:'ooo-bidpliot'}],
  ['@deepseek-ai/dsh-subagent',{maxDepth:2,maxActiveSubagents:4}],
  ['@deepseek-ai/dsh-subagent-spawn-in-process',{}],
  ['@deepseek-ai/dsh-user-questions',{}],
  ['@deepseek-ai/dsh-agent-loop',{agents:[],maxParallelToolCalls:2}],
  ['@deepseek-ai/dsh-session-checkpoint-policy',{}],
  ['@deepseek-ai/dsh-token-meter',{}],
  ['@deepseek-ai/dsh-compaction-tool-result-pruner',{}],
  ['@deepseek-ai/dsh-compaction-basic',{headroomTokens:8192}],
 ];
 const ready=Promise.withResolvers();
 scope.plugin({name:'ooo-bidpliot-business-runtime',async apply(ctx){
  try{
   for(const [name,config]of plugins){const module=await import(name);await ctx.plugin(module.default??module,config)}
   ctx.inject(['agents','agentLoop','sessions','sessionQuery','sessionPersistence','sessionProjections','attachments','agentPresets','subagents','tools','systemPrompt','skills','userQuestions','llm','agentDefaultModel','fs','subprocess','tokenMeter','compaction','toolResultPruner'],context=>{ready.resolve(context)});
  }catch(error){ready.reject(error);throw error}
 }});
 return {ctx:await ready.promise,close};
 }catch(error){await close();throw error}
}
