import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
const title='活动阶段新请求在等待whenIdle前拒绝，原请求重放及已结束同会话新轮次保留';
if(process.env.BIDV4_REENTRY_FIXTURE!=='1')test(title,()=>runIsolatedTest('stage-reentry-correctness.test.mjs','BIDV4_REENTRY_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const id='reentry-case',dir=join(dataRoot,'actions',id);await mkdir(dir,{recursive:true});
 const live={id:'real-parent',status:'running'},runtime=new BusinessRuntime({agents:new Map([[live.id,live]])});
 const record={task_id:id,session_id:live.id,action_id:'active-action',kind:'revise',start_seq:0};
 runtime.executionOwners.set(id,{actionId:record.action_id,agent:live,waitingForIdle:true});
 await writeFile(join(dir,'latest.json'),JSON.stringify(record));
 let awaited=false;runtime.settling.set(id,{then(){awaited=true;return new Promise(()=>{})}});
 const payload={kind:'revise',request_id:'different-new-request',input_version:'old-version',sections:[],instruction:'continue'};
 const timeout=new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('self wait cycle')),500);timer.unref()});
 await assert.rejects(Promise.race([runtime.action(id,payload,{agent:live}),timeout]),/不要再次调用run/);
 assert.equal(awaited,false);assert.deepEqual(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')),record);assert.equal(runtime.admissions.size,0);
 // A different caller also cannot wait indefinitely for an already running project.
 await assert.rejects(Promise.race([runtime.action(id,{...payload,request_id:'foreign-new-request'}),timeout]),/不要再次调用run/);assert.equal(awaited,false);
 // Exact request replay still returns its original action before the running guard.
 const key=createHash('sha256').update(payload.request_id).digest('hex');
 await writeFile(join(dir,key+'.json'),JSON.stringify({...record,payload_hash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')}));
 assert.deepEqual(await runtime.action(id,payload,{agent:live}),{session_id:live.id,action_id:record.action_id,replayed:true});
 // A new user turn in the same live Agent is not the old completed stage.
 await writeFile(join(dir,'latest.json'),JSON.stringify({...record,end_seq:9,outcome:{state:'completed'}}));
 let reachedState=false;runtime.settling.delete(id);runtime.state=async()=>{reachedState=true;throw Error('next-stage-state-reached')};
 await assert.rejects(runtime.action(id,{...payload,request_id:'completed-stage-new-request'},{agent:live}),/next-stage-state-reached/);assert.equal(reachedState,true);
});
