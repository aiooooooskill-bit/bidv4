import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessRuntime} from '../server/native/runtime.mjs';

// Actual runtime and business subprocess protocol, with in-memory tool responses.
// No files or model providers are used by these concurrency tests.
function fixture(){
 let state={execution:null,input_versions:{analyse:'v1'},source_selection:{main:'原始.docx',supplements:[]}};
 let fail=false,writeGate=null;const writes=[];
 const ctx={subprocess:{spawn(){let stdout;
  const received=Promise.withResolvers();
  return {stdin:{on(){},end(input){received.resolve(JSON.parse(input))}},done:received.promise.then(async({operation,args})=>{
   assert.equal(operation,'sources');writes.push(args);
   if(writeGate)await writeGate.promise;
   if(fail){fail=false;stdout=JSON.stringify({error:'存储不可用',status:503});return {exitCode:1}}
   state={...state,input_versions:{analyse:'v'+(Number(state.input_versions.analyse.slice(1))+1)},source_selection:{main:args.main_file,supplements:args.supplements.map(file=>({file,role:'补充文件'}))}};
   stdout=JSON.stringify({result:state.source_selection});return {exitCode:0};
  }),collected:{stdout:{readFrom:()=>({text:stdout})},stderr:{readFrom:()=>({text:''})}},terminate(){},waitForExit:async()=>{}};
 }}};
 const runtime=new BusinessRuntime(ctx);runtime.state=async()=>structuredClone(state);runtime.freezeAnalysis=async()=>{};
 return {runtime,writes,hold(){return writeGate=Promise.withResolvers()},fail(){fail=true},running(){state.execution={state:'running'}}};
}

test('来源保存共享项目提交锁，并发旧版本与生成动作被拒绝；成功后旧版本不能写入',async()=>{
 const f=fixture(),gate=f.hold(),payload={main_file:'更新.docx',supplements:[],input_version:'v1'};
 const first=f.runtime.saveSources('t1',payload);
 try{
  await assert.rejects(f.runtime.saveSources('t1',{...payload,main_file:'另一份.docx'}),e=>e.status===409);
  await assert.rejects(f.runtime.action('t1',{kind:'analyse'}),e=>e.status===409);
  await assert.rejects(f.runtime.assertIdle('t1'),e=>e.status===409);
  gate.resolve();const result=await first;assert.equal(result.source_selection.main,'更新.docx');assert.equal(result.input_versions.analyse,'v2');
  await assert.rejects(f.runtime.saveSources('t1',{...payload,main_file:'另一份.docx'}),e=>e.status===409&&e.message.includes('已变化'));
  assert.equal(f.writes.length,1);assert.equal(f.runtime.admissions.size,0);
 }finally{gate.resolve();await first}
});

test('来源写入失败与版本拒绝均释放提交锁，当前版本可再次保存',async()=>{
 const f=fixture(),payload={main_file:'更新.docx',supplements:[],input_version:'v1'};
 f.fail();await assert.rejects(f.runtime.saveSources('t1',payload),e=>e.status===503);assert.equal(f.runtime.admissions.size,0);
 await assert.rejects(f.runtime.saveSources('t1',{...payload,input_version:'old'}),e=>e.status===409);assert.equal(f.runtime.admissions.size,0);
 assert.equal((await f.runtime.saveSources('t1',payload)).source_selection.main,'更新.docx');assert.equal(f.runtime.admissions.size,0);
});

test('执行中的项目不保存来源，锁释放且未发出业务写入',async()=>{
 const f=fixture();f.running();await assert.rejects(f.runtime.saveSources('t1',{main_file:'更新.docx',supplements:[],input_version:'v1'}),e=>e.status===409);assert.equal(f.writes.length,0);assert.equal(f.runtime.admissions.size,0);
});
