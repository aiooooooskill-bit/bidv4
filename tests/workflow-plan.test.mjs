import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {dataRoot} from '../server/native/business.mjs';

test('自动完成拒绝过期计划并释放提交锁，不保存流程或创建动作',async()=>{
 const runtime=new BusinessRuntime({}),tid='plan-rejected-'+randomUUID();
 runtime.state=async()=>({execution:null,bidder:{confirmed:true,stale:false},source_selection:{main:'a.pdf'},input_versions:{analyse:'v2',build:'b2'}});runtime.freezeAnalysis=async()=>{};
 assert.throws(()=>runtime.workflows.start(tid,{}),e=>e.status===422);
 await assert.rejects(runtime.workflows.start(tid,{input_versions:{analyse:'v1',build:'b1'}}),e=>e.status===409&&/依据已变化/.test(e.message));
 assert.equal(runtime.admissions.size,0);assert.equal(runtime.workflows.starts.size,0);assert.equal(runtime.workflows.jobs.size,0);assert.equal(runtime.workflows.records.size,0);
 await assert.rejects(access(join(dataRoot,'workflows',tid+'.json')),e=>e.code==='ENOENT');await assert.rejects(access(join(dataRoot,'actions',tid)),e=>e.code==='ENOENT');
});

test('版本检查至启动登记期间共享项目锁，禁止来源和动作插入',async()=>{
 const runtime=new BusinessRuntime({}),tid='plan-admission-'+randomUUID(),entered=Promise.withResolvers(),release=Promise.withResolvers();
 runtime.state=async()=>{entered.resolve();await release.promise;return {execution:null,input_versions:{analyse:'new'}}};runtime.freezeAnalysis=async()=>{};
 const starting=runtime.workflows.start(tid,{input_versions:{analyse:'old'}});
 try{
  await entered.promise;
  await assert.rejects(runtime.saveSources(tid,{main_file:'new.pdf',supplements:[],input_version:'new'}),e=>e.status===409);
  await assert.rejects(runtime.sourceFile('POST','/files',{task_id:tid},{}),e=>e.status===409);
  await assert.rejects(runtime.action(tid,{kind:'analyse'}),e=>e.status===409);
  release.resolve();await assert.rejects(starting,e=>e.status===409&&/依据已变化/.test(e.message));assert.equal(runtime.admissions.size,0);
 }finally{release.resolve()}
});
