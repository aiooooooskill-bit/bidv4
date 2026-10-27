import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pythonExecutable} from '../platform.mjs';
export const root=fileURLToPath(new URL('../..',import.meta.url));
export const dataRoot=resolve(root,'data');
export function taskPathContext(taskId){
 return ['当前任务绝对路径：'+resolve(dataRoot,'workspace',taskId),
  '数据根目录：'+dataRoot,
  '全局工作区绝对路径：'+resolve(dataRoot,'workspace'),
  '业务技能绝对路径：'+resolve(root,'business/python/app/skills'),
  '路径约定：read/read_image/write/edit/glob/grep 等普通文件工具使用绝对路径。文档中的 work/…、sources/… 相对当前任务绝对路径；skills/… 相对业务技能绝对路径，去掉 skills/ 后拼接。工具返回的绝对路径直接使用。DOCX 工具的 path/dest、validate_body.section 和 docx_format_rule.evidence_path 使用相对任务 work/ 的路径，不加任务目录或 work/。docx_image_insert.image 使用知识库图源 knowledge/…（相对全局工作区）或本任务来源 sources/…（相对当前任务），不能与普通文件工具路径混用。',
 ].join('\n');
}
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
