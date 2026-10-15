import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pythonExecutable} from '../platform.mjs';
export const root=fileURLToPath(new URL('../..',import.meta.url));
export const dataRoot=resolve(root,'data');
export class BusinessError extends Error{constructor(status,message){super(message);this.status=status}}
export async function business(ctx,operation,args={},options={}){
 const child=ctx.subprocess.spawn({argv:[pythonExecutable(root),'-X','utf8',resolve(root,'business/python/runner.py')],cwd:root,stdio:{stdin:'pipe',stdout:{maxBytes:16*1024*1024},stderr:{maxBytes:8192}},graceMs:1000,signal:options.signal});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({operation,args,data_root:dataRoot,task_id:options.taskId,session_id:options.sessionId,call_id:options.callId}));
 try{
  const result=await child.done;options.signal?.throwIfAborted();
  const output=child.collected.stdout.readFrom(0).text;
  let value;try{value=JSON.parse(output)}catch{throw new BusinessError(500,'业务工具未能返回结果：'+child.collected.stderr.readFrom(0).text.slice(-2000))}
  if(result.exitCode!==0||value.error)throw new BusinessError(value.status??500,value.error??'业务工具执行未完成');
  return value.result;
 }finally{child.terminate();await child.waitForExit()}
}
