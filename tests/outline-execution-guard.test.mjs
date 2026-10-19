import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runIsolatedTest} from './helpers/isolated-app.mjs';
import {dataRoot} from '../server/native/business.mjs';
import {installExecutionGuard,outlineAssignments} from '../server/native/execution-guard.mjs';
const title='目录主子代理仅写本轮所属文件，独立分册不可互写、不可修改契约或停止后续写';
if(process.env.BIDV4_OUTLINE_GUARD_FIXTURE!=='1')test(title,()=>runIsolatedTest('outline-execution-guard.test.mjs','BIDV4_OUTLINE_GUARD_FIXTURE',new RegExp(title)));
else test(title,async()=>{
 const tid='outline-guard',cwd=join(dataRoot,'workspace',tid),action=join(dataRoot,'actions',tid);
 await mkdir(action,{recursive:true});
 const record={kind:'outline',session_id:'outline-main'};
 await writeFile(join(action,'latest.json'),JSON.stringify(record));
 const main={id:'outline-main',session:{id:'outline-main',header:{cwd}}};
 const child={id:'outline-child',session:{id:'outline-child',header:{cwd,origin:'subagent',parentSession:'outline-main'}}};
 let handler;const ctx={on(name,fn){if(name==='tools/execute')handler=fn;return()=>{}},agents:new Map([[main.id,main]]),fs:{async resolve(path){return {targetKey:resolve(path)}}}};
 installExecutionGuard(ctx,()=>{});outlineAssignments.set(child.id,join(cwd,'work/outline/fragments/技术册.md'));
 let passed=0;const run=(agent,name,file)=>handler({agent,name,arguments:{file_path:join(cwd,file)}},async()=>{passed++;return {content:[]}});
 try{
  await run(main,'write','work/outline/tender-response-docs.md');await run(child,'write','work/outline/fragments/技术册.md');await run(child,'read','work/outline/fragments/技术册.md');
  assert.equal(passed,3);
  for(const [agent,name,path] of [[main,'write','work/outline/fragments/技术册.md'],[child,'write','work/outline/fragments/商务册.md'],[child,'read','work/outline/fragments/商务册.md'],[child,'write','work/outline/tender-response-docs.md'],[main,'write','../../../outline-runs/outline-guard.json'],[child,'edit','work/analysis/evaluation.md'],[child,'assemble_tender',''],[main,'docx_section_repartition',''],[child,'docx_section_repartition',''],[main,'docx_section_create','']])await assert.rejects(run(agent,name,path));
  await writeFile(join(action,'latest.json'),JSON.stringify({...record,stopped_at:1}));await assert.rejects(run(child,'write','work/outline/fragments/技术册.md'),/变化或停止/);
  await unlink(join(action,'latest.json'));await assert.rejects(run(main,'assemble_tender',''),/先启动目录/);
  assert.equal(passed,3);
 }finally{outlineAssignments.delete(child.id)}
});
