import {foldSubagentDescriptor} from '@deepseek-ai/dsh-subagent';
import {subtaskProfiles} from './preset.mjs';

// The official spawn provider's configured name is recorded in the durable
// descriptor, so role composition survives cold resume without extra presets.
export function subtaskRole(agent){
 const provider=foldSubagentDescriptor(agent.session.snapshotEvents())?.provider;
 const role=provider?.startsWith('ooo-bidpliot-')?provider.slice('ooo-bidpliot-'.length):undefined;
 return role&&Object.hasOwn(subtaskProfiles,role)?role:undefined;
}

// DSH 0.2.1 owns each accepted activation independently of its admission signal.
// A turn cancellation must explicitly dispose that exact activation and join it.
export async function startSubtask(ctx,{parent,signal,role,prompt,label,childId}){
 signal.throwIfAborted();
 if(role!==undefined&&!Object.hasOwn(subtaskProfiles,role))throw new Error('未知招投标子任务角色：'+role);
 const run=await ctx.subagents.startActivation({provider:role===undefined?'spawn':'ooo-bidpliot-'+role,request:{parent,prompt,maxDepth:ctx.subagents.resolveMaxDepth(),...(role===undefined?{}:{agentPreset:'ooo-bidpliot'})},signal,label,delivery:'caller',...(childId===undefined?{}:{childId})});
 let disposing;
 const disposeOnce=()=>disposing??=(async()=>{await run.dispose()})();
 const abort=()=>{void disposeOnce().catch(()=>{})};
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)abort();
 return {...run,async dispose(){signal.removeEventListener('abort',abort);await disposeOnce()}};
}

// Accepted activations release the live Agent before resolving their result.
// Query the durable child session instead of retaining the removed localAgent.
export async function subagentFailure(ctx,run,result,message){
 if(result.diagnostic)return new Error(result.diagnostic);
 const observation=await ctx.sessionQuery.observeSession(run.childId,{projectionMode:'none'});
 try{
  const reason=observation.events.findLast(event=>event.type==='turn/end')?.data.reason;
  if(reason?.kind==='max-tokens')return new Error(message+'：本次输出预算已耗尽。先核对已保存成果和校验结果，按未完成的单节/小段继续，不重复整项制作；当前模型配置的输出上限若不足，应在已有模型设置中调整。');
  return new Error((reason?.kind==='error'?reason.error?.message:undefined)??message);
 }finally{observation[Symbol.dispose]()}
}
