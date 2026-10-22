import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {dataRoot,BusinessError,business} from './business.mjs';

const folder=tid=>join(dataRoot,'actions',tid,'writers');
const pending=new Map();
async function save(tid,childId,value){
 const path=join(folder(tid),childId+'.json');
 await mkdir(folder(tid),{recursive:true});
 await writeFile(path+'.tmp',JSON.stringify(value));await rename(path+'.tmp',path);
}
export async function bodyAssignment(tid,childId){
 try{return JSON.parse(await readFile(join(folder(tid),childId+'.json'),'utf8'))}
 catch(error){if(error.code==='ENOENT')return null;throw error}
}
export async function reserveBodyAssignment(ctx,tid,childId,parentId,sectionPaths,signal){
 const record=JSON.parse(await readFile(join(dataRoot,'actions',tid,'latest.json'),'utf8'));
 if(record.session_id!==parentId||record.stopped_at||!['body','revise','build'].includes(record.kind))throw new BusinessError(409,'正文派发必须属于当前制作主线程');
 const paths=[...new Set(sectionPaths)];
 if(!paths.length||paths.some(path=>!record.section_paths.includes(path)))throw new BusinessError(409,'写手章节必须属于本次明确选定的制作范围');
 // Reserve synchronously before disk I/O. The durable record also protects cold resume.
 const keys=paths.map(path=>tid+':'+record.action_id+':'+path);
 if(keys.some(key=>pending.has(key)))throw new BusinessError(409,'所派章节已有写手正在处理，请等待该任务完成');
 for(const key of keys)pending.set(key,childId);
 const assignment={action_id:record.action_id,parent_id:parentId,section_paths:paths,read_only:record.read_only===true,status:'active'};
 try{
  let files;try{files=await readdir(folder(tid))}catch(error){if(error.code!=='ENOENT')throw error;files=[]}
  const previouslyAssigned=new Set();
  for(const file of files.filter(name=>name.endsWith('.json'))){
   const old=await bodyAssignment(tid,file.slice(0,-5));
   if(old?.action_id===record.action_id)for(const path of old.section_paths)if(paths.includes(path))previouslyAssigned.add(path);
   if(old?.status==='active'&&old.action_id===record.action_id&&old.section_paths.some(path=>paths.includes(path))){
    const oldId=file.slice(0,-5),parent=ctx.agents.get(parentId);
    if(ctx.agents.get(oldId)||!parent)throw new BusinessError(409,'所派章节已有未结束的写手，未启动重叠任务');
    // Official drain joins startup/cleanup before the durable owner is released.
    await ctx.subagents.drainChildren(parent,[oldId]);
    signal?.throwIfAborted();
    await save(tid,oldId,{...old,status:'released',recovered_at:Date.now()});
   }
  }
  if(previouslyAssigned.size){
   const state=await business(ctx,'state',{task_id:tid},{signal});
   if(state.body_sections.some(section=>previouslyAssigned.has(section.path)&&section.status==='ready'&&section.validated_action_ids?.includes(record.action_id)))throw new BusinessError(409,'本轮已完成并校验的章节不能重复派发；需要修改时启动新的修订动作');
  }
  signal?.throwIfAborted();
  const current=JSON.parse(await readFile(join(dataRoot,'actions',tid,'latest.json'),'utf8'));
  if(current.action_id!==record.action_id||current.session_id!==parentId||current.stopped_at)throw new BusinessError(409,'制作动作已变化或停止');
  await save(tid,childId,assignment);
 }catch(error){for(const key of keys)if(pending.get(key)===childId)pending.delete(key);throw error}
 let released=false;
 return async()=>{if(released)return;released=true;try{await save(tid,childId,{...assignment,status:'released'})}finally{for(const key of keys)if(pending.get(key)===childId)pending.delete(key)}};
}

// Queue writers at DSH's configured child capacity; document locks isolate writes.
export class BodyTaskSlots{
 active=0;queue=[];
 constructor(limit){this.limit=limit}
 async acquire(signal){
  signal.throwIfAborted();
  if(this.active>=this.limit())await new Promise((resolve,reject)=>{
   const entry={resolve:()=>{signal.removeEventListener('abort',abort);resolve()},reject};
   const abort=()=>{this.queue.splice(this.queue.indexOf(entry),1);reject(signal.reason)};
   signal.addEventListener('abort',abort,{once:true});this.queue.push(entry);
  });else this.active++;
  if(signal.aborted){this.release();signal.throwIfAborted()}
  let done=false;return()=>{if(!done){done=true;this.release()}};
 }
 release(){this.active--;while(this.queue.length&&this.active<this.limit()){this.active++;this.queue.shift().resolve()}}
}
