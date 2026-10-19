import {deliveryReady} from '../../shared/delivery-status.js';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {dataRoot,BusinessError} from './business.mjs';
const stages=['analyse','outline','build','review'];
const incompleteReview=state=>state.execution?.kind==='review'&&state.execution.state==='failed';
const file=tid=>join(dataRoot,'workflows',tid+'.json');
async function read(tid){try{return JSON.parse(await readFile(file(tid),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function save(tid,value){await mkdir(join(dataRoot,'workflows'),{recursive:true});const temporary=file(tid)+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value));await rename(temporary,file(tid))}
export class Workflows{
 constructor(runtime){this.runtime=runtime;this.jobs=new Map();this.records=new Map();this.starts=new Map()}
 active(tid){return this.jobs.has(tid)}
 async snapshot(tid){const record=await read(tid);if(record?.state==='running'&&!this.active(tid))return {...record,state:'interrupted',error:'自动流程已中断，已有成果保留，可继续流程。'};return record}
 start(tid,options={}){if(this.starts.has(tid))return this.starts.get(tid);const pending=this.startOnce(tid,options).finally(()=>this.starts.delete(tid));this.starts.set(tid,pending);return pending}
 async startOnce(tid,options={}){
  this.runtime.assertOpen();
  if(this.active(tid))return this.snapshot(tid);
  let record=await read(tid);
  if(!options.resume||!record)await this.runtime.assertIdle(tid);
  else{const current=await this.runtime.state(tid);if(['running','needs_input'].includes(current.execution?.state)&&current.execution.action_id!==record.action_id)throw new BusinessError(409,'项目已有其他执行');if(current.execution?.state==='needs_input')return record}
  if(options.resume&&record&&!['completed','stopped'].includes(record.state)){
   const state=await this.runtime.state(tid);
   const sameReviewBasis=incompleteReview(state)&&(await this.runtime.latestRecord(tid,'review'))?.record.input_version===state.input_versions.review&&(await this.runtime.reviewProgress(tid,record.session_id)).accepted>0;
   if(record.session_id&&(state.execution?.action_id!==record.action_id||state.execution.state==='stopped'||(state.execution.state==='failed'&&!sameReviewBasis)))record.session_id=null;
   for(let index=0;index<record.index;index++){const stage=stages[index];let valid=true;if(['analyse','outline'].includes(stage)){try{await this.runtime.requireCurrent(tid,stage,state)}catch(e){if(e.status!==409)throw e;valid=false}}if(stage==='build')valid=deliveryReady(state);if(!valid){record.index=index;record.completed=record.completed.slice(0,index);record.session_id=null;break}}
   if(!record.session_id){record.attempt=(record.attempt??0)+1;record.payload=null}
  }else record={id:randomUUID(),state:'running',index:0,completed:[],options:{page_target:options.page_target??null,numbering:options.numbering??'decimal'},session_id:null,attempt:0};
  record.state='running';delete record.error;await save(tid,record);
  this.records.set(tid,record);const ready=Promise.withResolvers();const job=this.run(tid,record,options.agent,ready).finally(()=>{this.jobs.delete(tid);this.records.delete(tid)});this.jobs.set(tid,job);
  // Both entries own the same job; chat execution continues in its current turn.
  void job.catch(()=>{});await ready.promise;return {...record};
 }
 resumeAfter(tid,agent){
  if(this.starts.has(tid))return this.starts.get(tid);
  const pending=agent.whenIdle().then(()=>this.runtime.settling.get(tid)).then(()=>this.startOnce(tid,{resume:true})).finally(()=>{if(this.starts.get(tid)===pending)this.starts.delete(tid)});this.starts.set(tid,pending);void pending.catch(e=>console.error(e.message));return pending;
 }
 async wait(tid){await this.starts.get(tid);await this.jobs.get(tid);return this.snapshot(tid)}
 async run(tid,record,agent,ready){
  try{
   while(record.index<stages.length&&record.state==='running'){
    const kind=stages[record.index];record.stage=kind;await save(tid,record);
    let state=await this.runtime.state(tid);
    if(!record.session_id){
     // Reuse only currently valid, complete upstream work.
     let reusable=false;
     if(['analyse','outline'].includes(kind)){try{await this.runtime.requireCurrent(tid,kind,state);reusable=true}catch(e){if(e.status!==409)throw e}}
     if(kind==='build')reusable=deliveryReady(state);
     if(kind==='review')reusable=state.review.status==='reviewed';
     if(reusable){record.completed.push(kind);record.index++;record.payload=null;continue}
     record.payload??={kind,request_id:record.id+':'+record.index+':'+record.attempt,input_version:state.input_versions[kind],...(kind==='analyse'?{main_file:state.source_selection.main,supplements:state.source_selection.supplements.map(s=>s.file)}:{}),...(kind==='outline'?record.options:{}),...(kind==='build'?{sections:[]}:{} )};
     await save(tid,record);
     const action=await this.runtime.action(tid,record.payload,{workflowId:record.id,...(agent?{agent}:{})});agent=null;record.session_id=action.session_id;record.action_id=action.action_id;await save(tid,record);ready.resolve();if(record.state==='stopped'){await this.runtime.stop(tid,record.session_id,record.action_id);break}
    }
    const handle=await this.runtime.handle({...(await this.runtime.latestRecord(tid,kind)).record});
    await handle.agent.whenIdle();await this.runtime.settling.get(tid);
    state=await this.runtime.state(tid);
    if(record.state==='stopped')break;
    if(state.execution?.action_id!==record.action_id)throw new BusinessError(409,'当前执行已变化，自动流程已停止');
    if(state.execution.state==='stopped'){record.state='stopped';break}
    if(state.execution.state==='needs_input'){record.state='needs_input';record.error='请填写本次执行的具体问题后继续';break}
    if(kind==='review'&&incompleteReview(state)){
     const progress=await this.runtime.reviewProgress(tid,record.session_id);
     // Continue only after durable progress. A second empty turn fails explicitly.
     if(progress.accepted>(record.review_progress??0)){
      await this.runtime.continueReview(tid,record.action_id);record.review_progress=progress.accepted;await save(tid,record);ready.resolve();continue;
     }
    }
    if(state.execution.state!=='completed')throw new BusinessError(422,state.execution.error??'本阶段未完成');
    record.completed.push(kind);record.index++;record.session_id=null;record.payload=null;await save(tid,record);
   }
   if(record.state==='running')record.state='completed';
  }catch(error){if(record.state!=='stopped'){record.state='failed';record.error=error.message}}
  await save(tid,record);ready.resolve();
 }
 async stop(tid,expected){
  const record=this.records.get(tid)??await read(tid);
  if(expected&&(!record||('workflow_id' in expected?record.id!==expected.workflow_id:record.session_id!==expected.session_id||record.action_id!==expected.action_id)))throw new BusinessError(409,'当前执行已变化');
  if(!record)return {ok:true};record.state='stopped';await save(tid,record);
  // The running loop shares this object through its job; stop the actual Agent
  // and let its persisted stopped state terminate the loop before another phase.
  if(record.session_id)await this.runtime.stop(tid,record.session_id,record.action_id);
  await this.jobs.get(tid);
  const current=await read(tid);current.state='stopped';await save(tid,current);return {ok:true};
 }
 async close(){await Promise.allSettled([...this.starts.values()]);await Promise.all([...this.jobs.keys()].map(tid=>this.stop(tid)))}
}
