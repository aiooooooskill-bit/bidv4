import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BusinessRuntime} from '../server/native/runtime.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {analysisCategories} from '../shared/analysis-progress.js';

for(const ending of ['completed','failed','stopped'])test(`解读进度跨阶段保留，${ending}后人工改写不增加；新轮重新统计`,async()=>{
 const tid='t_progress_'+randomUUID(),dir=join(dataRoot,'actions',tid);
 let state={files:analysisCategories.flatMap(c=>c.paths.map(path=>({path:'analysis/'+path,content:'旧文档',hash:path,modified_at:1}))),input_versions:{outline:'same'}};
 const ctx={subprocess:{spawn(){return {
  stdin:{on(){},end(){}},done:Promise.resolve({exitCode:0}),
  collected:{stdout:{readFrom:()=>({text:JSON.stringify({result:state})})},stderr:{readFrom:()=>({text:''})}},
  terminate(){},waitForExit:async()=>{},
 }}}};
 const runtime=new BusinessRuntime(ctx);let execution='running';runtime.handle=async()=>({agent:{status:execution==='running'?'running':'idle'}});runtime.projection=async()=>({state:execution});
 const record={task_id:tid,session_id:'first',kind:'analyse',created_at:100,analysis_before:Object.fromEntries(state.files.map(f=>[f.path,f.hash]))};
 const persist=async(name,value)=>writeFile(join(dir,name),JSON.stringify(value));
 try{
  await mkdir(dir,{recursive:true});await persist('first.json',record);await persist('latest.json',record);
  assert.ok((await runtime.state(tid)).analysis_progress.every(p=>p.done===0));
  state.files[0].modified_at=101;assert.equal((await runtime.state(tid)).analysis_progress[0].done,1,'运行中同内容重写算新产出');
  execution='needs_input';await runtime.freezeAnalysis(tid,'first');assert.equal(JSON.parse(await readFile(join(dir,'first.json'),'utf8')).analysis_progress,undefined);
  state.files[1].hash='new';execution=ending;await runtime.freezeAnalysis(tid,'first');const frozen=(await runtime.state(tid)).analysis_progress;assert.equal(frozen[0].done,2);
  for(const file of state.files){file.hash+='manual';file.modified_at=200}
  assert.deepEqual((await runtime.state(tid)).analysis_progress,frozen,'终态快照不累计人工编辑');
  await persist('latest.json',{kind:'guide',created_at:201});assert.deepEqual((await runtime.state(tid)).analysis_progress,frozen,'后续动作不恢复旧解读进度');
  const next={...record,session_id:'second',created_at:300,analysis_before:Object.fromEntries(state.files.map(f=>[f.path,f.hash]))};await persist('second.json',next);await persist('latest.json',next);execution='running';assert.ok((await runtime.state(tid)).analysis_progress.every(p=>p.done===0));
 }finally{await rm(dir,{recursive:true,force:true})}
});
